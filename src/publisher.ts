/**
 * The "Publish document" and "Unpublish document" commands: reads the note,
 * talks to the PDS, and writes the result back to the note. The decisions
 * live in pure, tested modules (convert/*, publish-steps.ts, pds.ts); this
 * file only connects them to Obsidian, so it's checked by hand in a dev vault
 * (see the guide, Task 7).
 */
import { ClientResponseError, type Client } from '@atcute/client';
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
import type { Blob } from '@atcute/lexicons';

const ERROR_NOTICE_MS = 10_000;

/** Everything the commands need about the note being published. */
export interface Note {
	file: TFile;
	frontmatter: Record<string, unknown> | undefined;
	/** The note's text after its frontmatter. */
	body: string;
}

export class Publisher {
	/** The logged-in session, kept in memory only, and reused while the handle doesn't change. */
	private session: { identifier: string; passwordSecret: string; account: Account; rpc: Client } | undefined;

	constructor(private readonly plugin: AtprotoPublishPlugin) {}

	private get app(): App {
		return this.plugin.app;
	}

	/** Can the command run on this file? Used by the commands' `checkCallback`. */
	canPublish(file: TFile | null): file is TFile {
		return file !== null && file.extension === 'md' && isInFolder(file.path, this.plugin.settings.documentsFolder);
	}

	forgetSession(): void {
		this.session = undefined;
	}

	/**
	 * Runs a command and reports the outcome. A `PublishError` is shown as-is
	 * (it's written for the author); anything else is unexpected: show
	 * "Publishing failed: <message>" and `console.error` the error for
	 * debugging.
	 */
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
	 * "Publish document". In order (the order matters, see the guide):
	 *
	 * 1. `readNote(file)`; `parseDocumentMeta(frontmatter, file.basename)`;
	 *    `path = expandPath(settings.pathTemplate, meta.slug)`.
	 * 2. `login()`. Then the publication's site URL:
	 *    `getPublication(publicClient(<the publication owner's PDS>), settings.publicationUri)`.
	 *    The owner's PDS is your own when the publication URI's DID is your DID;
	 *    otherwise `resolveAccount(<that DID>)` first.
	 * 3. `listDocuments` → `checkPath(records, path, meta.uri, <another note links to it>)`:
	 *    - `conflict` → `PublishError` naming the other document by its title,
	 *      and the note linked to it when there is one.
	 *    - `relink` → `confirmRelink(app, title)`; yes → use that `uri`, no → stop quietly.
	 * 4. No `uri` yet → `rkey = newTid()`, `uri = documentUri(did, rkey)`, and
	 *    **write `atproto_uri` and `slug` to the frontmatter now**
	 *    (`app.fileManager.processFrontMatter`), before any write to the PDS.
	 *    A failed or retried publish then reuses the same record key.
	 * 5. `toGfm(body, { strictLineBreaks: this.strictLineBreaks() })`, keep its
	 *    warnings and `hasMath`. `findEmbeds`; for each of `imageTargets(…)`:
	 *    `resolve(target)`, `app.vault.readBinary`, `imageTypeOf`,
	 *    `uploadImage` → remember `{ image: blob, alt }` and `blobUrl(pds, did, cid)`.
	 *    Then `replaceEmbeds(markdown, (embed) => renderEmbed(embed, …).markdown)`,
	 *    collecting warnings; links resolve to `joinUrl(siteUrl, expandPath(template, <their slug>))`
	 *    when the linked note has an `atproto_uri` and a `slug`.
	 *    `plainText = toPlainText(markdown)`.
	 * 6. `meta.cover` → resolve, read, `imageTypeOf`, `checkCoverSize`, upload.
	 * 7. `buildDocument` → `mergeForUpdate` → `putDocument(…, swapRecord: existing?.cid ?? null)`,
	 *    skipped when `sameDocument` says nothing changed. (`getDocument` runs
	 *    before step 5, so images the record already has are reused, not re-uploaded.)
	 * 8. `markPublished` (via `processFrontMatter`) with the record's
	 *    `publishedAt`, now, and `fingerprint(meta, body)` of the note **as read
	 *    in step 1**. A `Notice` naming the note's title and the PDS's host
	 *    (where the plugin actually put it), plus any warnings.
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
			fm['atproto_uri'] = docUri;
			fm['slug'] = docMeta.slug;
		});

		// Fetched before the images, so images already on the record aren't uploaded again. A record
		// key generated just now can't have a record yet; anything else might (a republish, a re-link,
		// or a retry after a failed publish).
		const rkey = rkeyOf(docUri);
		const existingDoc = isNew ? undefined : await getDocument(session.rpc, session.account.did, rkey);

		const md = toGfm(note.body, {strictLineBreaks: this.strictLineBreaks()});
		// Everything the author should know wasn't published as it looks in Obsidian; shown with the success notice.
		const warnings: string[] = [...md.warnings];
		const embeds = findEmbeds(md.markdown);
		const uploads = new Map<string,{ blob: Blob; url: string}>(); 
		for (const target of imageTargets(embeds)) {
			const imageFile = this.resolve(target, file);
			if (!imageFile) continue;
			const imageBytes = new Uint8Array(await this.app.vault.readBinary(imageFile));
			const imageType = imageTypeOf(target, imageBytes);
			const upload = await this.uploadUnlessKept(session.rpc, imageBytes, imageType, existingDoc?.value);
			const uploadUrl = blobUrl(session.account.pds, session.account.did, upload.ref.$link);
			uploads.set(target, {blob: upload, url: uploadUrl});
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
			plainText: plainText,
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
		// An unchanged record keeps its dates, so the note keeps saying when it really last changed.
		const updatedAt = unchanged ? (existingDoc.value.updatedAt ?? existingDoc.value.publishedAt) : now;

		// Only now that the record is written does the note say it's published. The hash is of the
		// note as read at the start (what the author wrote), and is computed first because
		// processFrontMatter's callback must be synchronous.
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

	/**
	 * "Unpublish document": the note must have an `atproto_uri`, otherwise
	 * `PublishError` ("This note isn't published."). `login()`, `getDocument`
	 * (already gone → just clear the frontmatter), `deleteDocument` with its
	 * CID as `swapRecord`, `markUnpublished` via `processFrontMatter`, and a
	 * `Notice` naming the note's title and the PDS's host.
	 */
	async unpublish(file: TFile): Promise<void> {
		const note = await this.readNote(file);
		// Only the link to the record matters here, not the publishing rules (see parseDocumentUri).
		const uri = parseDocumentUri(note.frontmatter?.atproto_uri);
		if (!uri) throw new PublishError("This note isn't published, so there's nothing to unpublish.");
		// The same title rule as publishing, without refusing a note whose other properties are invalid.
		const titleProperty = note.frontmatter?.title;
		const title = typeof titleProperty === 'string' && titleProperty.trim() ? titleProperty.trim() : file.basename;

		const session = await this.login();

		const rkey = rkeyOf(uri);
		const existingDoc = await getDocument(session.rpc, session.account.did, rkey);
		if (existingDoc) {
			await deleteDocument(session.rpc, session.account.did, rkey, existingDoc.cid);
		}
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			markUnpublished(fm);
		});

		new Notice(`Unpublished "${title}" from ${new URL(session.account.pds).host}.`);
	}

	/**
	 * The note's properties (parsed from the file's own text, so they always
	 * match the body) and the body after them. Also used by the status bar, so
	 * both compute the same fingerprint. Broken YAML → `PublishError`.
	 */
	async readNote(file: TFile): Promise<Note> {
		const text = await this.app.vault.read(file);
		const info = getFrontMatterInfo(text);
		const frontmatter = info.exists ? parseFrontmatter(info.frontmatter) : undefined;
		return { file, frontmatter, body: text.slice(info.contentStart) };
	}

	/**
	 * The cached session, or a new one: `resolveAccount(settings.identifier)`,
	 * the app password from `app.secretStorage.getSecret(settings.passwordSecret)`
	 * (missing → `PublishError` pointing at the settings), then `connect`.
	 * Start over if `settings.identifier` changed since the session was made.
	 */
	private async login(): Promise<{ account: Account; rpc: Client }> {
		const settings = this.plugin.settings;
		const identifier = settings.identifier;
		if (!this.session || this.session.identifier !== identifier || this.session.passwordSecret !== settings.passwordSecret) {
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
		return {account: this.session.account, rpc: this.session.rpc};
	}

	/**
	 * The blob for these bytes: the one already on the existing record when it
	 * has the same CID, otherwise a fresh upload. Re-uploading bytes the PDS
	 * already stores would only leave an orphaned temporary copy in its blob storage.
	 */
	private async uploadUnlessKept(
		rpc: Client,
		bytes: Uint8Array,
		mimeType: Parameters<typeof uploadImage>[2],
		existing: DocumentRecord | undefined,
	): Promise<Blob> {
		return reusableBlob(existing, await blobCid(bytes)) ?? (await uploadImage(rpc, bytes, mimeType));
	}

	/** The note, other than `except`, whose `atproto_uri` is this record, if any. */
	private linkedNote(uri: string, except: TFile): TFile | undefined {
		return this.app.vault.getMarkdownFiles().find((candidate) => {
			if (candidate === except) return false;
			const linked: unknown = this.app.metadataCache.getFileCache(candidate)?.frontmatter?.atproto_uri;
			return typeof linked === 'string' && linked.trim() === uri;
		});
	}

	/** A vault file for a link or embed target, relative to `from`: `app.metadataCache.getFirstLinkpathDest(target, from.path)`. */
	private resolve(target: string, from: TFile): TFile | null {
		return this.app.metadataCache.getFirstLinkpathDest(target, from.path);
	}

	/** Where an embed should point, if anywhere: an uploaded image's blob URL, or a published note's page. */
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
				// The linked note, resolved the way Obsidian would from this note.
				const linked = this.resolve(embed.target, from);
				const fm: Record<string, unknown> | undefined = linked
					? this.app.metadataCache.getFileCache(linked)?.frontmatter
					: undefined;
				// Only notes that are published (have a record) and have a pinned slug get a link.
				if (typeof fm?.atproto_uri !== 'string' || typeof fm.slug !== 'string') return {};
				return { url: joinUrl(siteUrl, expandPath(this.plugin.settings.pathTemplate, fm.slug)) };
			}
			case 'file':
				return {};
		}
	}

	/**
	 * Obsidian's "Strict line breaks" setting. Not in the public API types, so:
	 * `(this.app.vault as unknown as { getConfig(key: string): unknown }).getConfig('strictLineBreaks') === true`.
	 * Anything other than `true` means off, Obsidian's default.
	 */
	private strictLineBreaks(): boolean {
		return (this.app.vault as unknown as { getConfig(key: string): unknown }).getConfig('strictLineBreaks') === true;
	}
}

/**
 * The note's properties as an object, or undefined when there are none.
 * Broken YAML → a PublishError the author can act on.
 */
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
	// An empty block parses to null, and a block containing only a list parses to an array:
	// neither is a set of properties.
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
	return parsed as Record<string, unknown>;
}
