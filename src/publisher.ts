/**
 * The publish and unpublish commands: Obsidian glue around the pure modules in
 * convert/, publish-steps.ts and pds.ts.
 */
import { ClientResponseError, type Client } from '@atcute/client';
import type { Blob } from '@atcute/lexicons';
import { now as newTid } from '@atcute/tid';
import { type App, getFrontMatterInfo, MarkdownView, Notice, parseYaml, type TFile } from 'obsidian';

import { parseDocumentMeta, parseDocumentUri, PublishError } from './convert/document.ts';
import { type Embed, findEmbeds, replaceEmbeds } from './convert/embeds.ts';
import { toGfm } from './convert/ofm.ts';
import { toPlainText } from './convert/plaintext.ts';
import { buildDocument, checkPath, type DocumentRecord, mergeForUpdate } from './convert/record.ts';
import { fingerprint } from './convert/status.ts';
import type AtprotoPublishPlugin from './main.ts';
import {
	type Account,
	checkCoverSize,
	connect,
	deleteDocument,
	getDocument,
	getPublication,
	imageTypeOf,
	listDocuments,
	publicClient,
	putDocument,
	resolveAccount,
	uploadImage,
} from './pds.ts';
import {
	blobCid,
	documentUri,
	type EmbedTarget,
	imageTargets,
	isInFolder,
	markPublished,
	markUnpublished,
	renderEmbed,
	reusableBlob,
	rkeyOf,
	sameDocument,
} from './publish-steps.ts';
import { confirmRelink } from './relink-modal.ts';
import { blobUrl, expandPath, joinUrl } from './urls.ts';

const ERROR_NOTICE_MS = 10_000;

export interface Note {
	file: TFile;
	frontmatter: Record<string, unknown> | undefined;
	/** Text after the frontmatter. */
	body: string;
}

export class Publisher {
	/** In memory only; reused until the handle or app password setting changes. */
	private session: { identifier: string; passwordSecret: string; account: Account; rpc: Client } | undefined;

	constructor(private readonly plugin: AtprotoPublishPlugin) {}

	private get app(): App {
		return this.plugin.app;
	}

	canPublish(file: TFile | null): file is TFile {
		return file !== null && file.extension === 'md' && isInFolder(file.path, this.plugin.settings.documentsFolder);
	}

	forgetSession(): void {
		this.session = undefined;
	}

	/** Runs a command, showing `PublishError`s as-is and logging anything else. */
	async run(action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (error) {
			if (error instanceof ClientResponseError && error.status === 401) this.forgetSession();
			if (error instanceof PublishError) {
				new Notice(error.message, ERROR_NOTICE_MS);
			} else {
				console.error('ATproto Publish:', error);
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`Publishing failed: ${message}`, ERROR_NOTICE_MS);
			}
		}
	}

	/**
	 * Order matters: `atproto_uri` is written to the note before anything is
	 * written to the PDS, so a retried publish reuses the same record key.
	 */
	async publish(file: TFile): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file === file) await view.save();

		const note = await this.readNote(file);
		const docMeta = parseDocumentMeta(note.frontmatter, note.file.basename);
		const filePath = expandPath(this.plugin.settings.pathTemplate, docMeta.slug);

		const session = await this.login();

		const publication = await getPublication(publicClient(session.account.pds), this.plugin.settings.publicationUri);
		const docs = await listDocuments(session.rpc, session.account.did);
		let docUri = docMeta.uri;
		const pathCheck = checkPath(docs, filePath, docUri, (uri) => this.linkedNote(uri, file) !== undefined);
		if (pathCheck.kind === 'conflict') {
			const owner = this.linkedNote(pathCheck.uri, file);
			const usedBy = owner ? `"${pathCheck.title}" (note: ${owner.basename})` : `"${pathCheck.title}"`;
			throw new PublishError(
				`This note's slug "${docMeta.slug}" is already used by ${usedBy}. Change this note's "slug" to publish it separately.`,
			);
		}
		if (pathCheck.kind === 'relink') {
			if (!(await confirmRelink(this.app, pathCheck.title))) {
				return;
			}
			docUri = pathCheck.uri;
		}
		const isNew = !docUri;
		if (!docUri) {
			docUri = documentUri(session.account.did, newTid());
		}
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.atproto_uri = docUri;
			fm.slug = docMeta.slug;
		});

		// Fetched before uploading images so ones already on the record can be reused.
		// A freshly generated key can't have a record yet.
		const rkey = rkeyOf(docUri);
		const existingDoc = isNew ? undefined : await getDocument(session.rpc, session.account.did, rkey);

		const md = toGfm(note.body, { strictLineBreaks: this.strictLineBreaks() });
		// Shown with the success notice: anything that won't look as it does in Obsidian.
		const warnings: string[] = [...md.warnings];
		const embeds = findEmbeds(md.markdown);
		const uploads = new Map<string, { blob: Blob; url: string }>();
		for (const target of imageTargets(embeds)) {
			const imageFile = this.resolve(target, file);
			if (!imageFile) continue;
			const imageBytes = new Uint8Array(await this.app.vault.readBinary(imageFile));
			const imageType = imageTypeOf(target, imageBytes);
			const upload = await this.uploadUnlessKept(session.rpc, imageBytes, imageType, existingDoc?.value);
			const uploadUrl = blobUrl(session.account.pds, session.account.did, upload.ref.$link);
			uploads.set(target, { blob: upload, url: uploadUrl });
		}
		const replaced = replaceEmbeds(md.markdown, (embed) => {
			const rendered = renderEmbed(embed, this.embedTarget(embed, file, uploads, publication.url));
			if (rendered.warning) warnings.push(rendered.warning);
			return rendered.markdown;
		});
		const plainText = toPlainText(replaced);

		let coverUpload: Blob | undefined;
		if (docMeta.cover) {
			const coverFile = this.resolve(docMeta.cover, file);
			if (!coverFile) throw new PublishError(`The cover image "${docMeta.cover}" wasn't found in the vault.`);
			const coverBytes = new Uint8Array(await this.app.vault.readBinary(coverFile));
			checkCoverSize(coverFile.path, coverBytes.byteLength);
			const coverType = imageTypeOf(docMeta.cover, coverBytes);
			coverUpload = await this.uploadUnlessKept(session.rpc, coverBytes, coverType, existingDoc?.value);
		}

		const now = new Date().toISOString();
		const nextDoc = buildDocument({
			meta: docMeta,
			path: filePath,
			markdown: replaced,
			plainText,
			hasMath: md.hasMath,
			publicationUri: this.plugin.settings.publicationUri,
			images: [...uploads.values()].map(({ blob }) => ({ image: blob })),
			coverImage: coverUpload,
			now,
		});

		const mergedDoc = mergeForUpdate(existingDoc?.value, nextDoc, { now, date: docMeta.date });
		const unchanged = existingDoc !== undefined && sameDocument(existingDoc.value, mergedDoc);
		if (!unchanged) {
			await putDocument(session.rpc, session.account.did, rkey, mergedDoc, existingDoc?.cid ?? null);
		}
		// Skipping the write keeps the record's dates, so the note keeps them too.
		const updatedAt = unchanged ? (existingDoc.value.updatedAt ?? existingDoc.value.publishedAt) : now;

		// Hash the note as read, not as rewritten; processFrontMatter's callback must be synchronous.
		const hash = await fingerprint(docMeta, note.body);
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			markPublished(fm, {
				uri: docUri,
				slug: docMeta.slug,
				publishedAt: mergedDoc.publishedAt,
				updatedAt,
				hash,
			});
		});

		const host = new URL(session.account.pds).host;
		const outcome = unchanged
			? `"${docMeta.title}" is already up to date on ${host}.`
			: `Published "${docMeta.title}" to ${host}.`;
		new Notice([outcome, ...warnings].join('\n'), warnings.length > 0 ? 15_000 : 5_000);
	}

	async unpublish(file: TFile): Promise<void> {
		const note = await this.readNote(file);
		const uri = parseDocumentUri(note.frontmatter?.atproto_uri);
		if (!uri) throw new PublishError("This note isn't published, so there's nothing to unpublish.");
		// Same title rule as publishing, without validating the rest of the note.
		const titleProperty = note.frontmatter?.title;
		const title = typeof titleProperty === 'string' && titleProperty.trim() ? titleProperty.trim() : file.basename;

		const session = await this.login();

		const rkey = rkeyOf(uri);
		const existingDoc = await getDocument(session.rpc, session.account.did, rkey);
		// Already gone: just clear the link.
		if (existingDoc) {
			await deleteDocument(session.rpc, session.account.did, rkey, existingDoc.cid);
		}
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			markUnpublished(fm);
		});

		new Notice(`Unpublished "${title}" from ${new URL(session.account.pds).host}.`);
	}

	/**
	 * Parses frontmatter from the file text itself so it always matches the body.
	 * Shared with the status bar so both compute the same fingerprint.
	 */
	async readNote(file: TFile): Promise<Note> {
		const text = await this.app.vault.read(file);
		const info = getFrontMatterInfo(text);
		const frontmatter = info.exists ? parseFrontmatter(info.frontmatter) : undefined;
		return { file, frontmatter, body: text.slice(info.contentStart) };
	}

	private async login(): Promise<{ account: Account; rpc: Client }> {
		const settings = this.plugin.settings;
		const identifier = settings.identifier;
		if (
			!this.session ||
			this.session.identifier !== identifier ||
			this.session.passwordSecret !== settings.passwordSecret
		) {
			if (identifier === '') throw new PublishError('Set your handle in Settings → ATproto Publish.');
			if (settings.passwordSecret === '') {
				throw new PublishError('Choose an app password in Settings → ATproto Publish.');
			}
			const password = this.app.secretStorage.getSecret(settings.passwordSecret);
			if (!password) {
				throw new PublishError(
					`The app password "${settings.passwordSecret}" isn't saved on this device. Choose or re-enter it in Settings → ATproto Publish.`,
				);
			}
			const account = await resolveAccount(identifier);
			const rpc = await connect(account, identifier, password);
			this.session = { account, identifier, passwordSecret: settings.passwordSecret, rpc };
		}
		return { account: this.session.account, rpc: this.session.rpc };
	}

	/** Reuses a blob already on the record instead of uploading identical bytes again. */
	private async uploadUnlessKept(
		rpc: Client,
		bytes: Uint8Array,
		mimeType: Parameters<typeof uploadImage>[2],
		existing: DocumentRecord | undefined,
	): Promise<Blob> {
		return reusableBlob(existing, await blobCid(bytes)) ?? (await uploadImage(rpc, bytes, mimeType));
	}

	/** The note, other than `except`, linked to this record. */
	private linkedNote(uri: string, except: TFile): TFile | undefined {
		return this.app.vault.getMarkdownFiles().find((candidate) => {
			if (candidate === except) return false;
			const linked: unknown = this.app.metadataCache.getFileCache(candidate)?.frontmatter?.atproto_uri;
			return typeof linked === 'string' && linked.trim() === uri;
		});
	}

	private resolve(target: string, from: TFile): TFile | null {
		return this.app.metadataCache.getFirstLinkpathDest(target, from.path);
	}

	/** An uploaded image's blob URL, or a published note's page. */
	private embedTarget(
		embed: Embed,
		from: TFile,
		uploads: Map<string, { blob: Blob; url: string }>,
		siteUrl: string,
	): EmbedTarget {
		switch (embed.kind) {
			case 'image':
				return { url: uploads.get(embed.target)?.url };
			case 'link': {
				const linked = this.resolve(embed.target, from);
				const fm: Record<string, unknown> | undefined = linked
					? this.app.metadataCache.getFileCache(linked)?.frontmatter
					: undefined;
				// Only published notes with a pinned slug become links.
				if (typeof fm?.atproto_uri !== 'string' || typeof fm.slug !== 'string') return {};
				return { url: joinUrl(siteUrl, expandPath(this.plugin.settings.pathTemplate, fm.slug)) };
			}
			case 'file':
				return {};
		}
	}

	/** Obsidian's "Strict line breaks" setting, which isn't in the public API types. */
	private strictLineBreaks(): boolean {
		return (this.app.vault as unknown as { getConfig(key: string): unknown }).getConfig('strictLineBreaks') === true;
	}
}

function parseFrontmatter(yaml: string): Record<string, unknown> | undefined {
	let parsed: unknown;
	try {
		parsed = parseYaml(yaml);
	} catch (error) {
		throw new PublishError(
			"This note's properties aren't valid YAML, so it can't be published. Check the Properties panel.",
			{ cause: error },
		);
	}
	// An empty block parses to null, a bare list to an array.
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
	return parsed as Record<string, unknown>;
}
