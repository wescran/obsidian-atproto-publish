/**
 * The decisions the publish and unpublish commands make, kept free of
 * Obsidian and the network so they can be unit-tested. `publisher.ts` does
 * the reading, uploading and writing around them.
 */
import { CODEC_RAW, create as createCid, toString as cidToString } from '@atcute/cid';
import type { Blob } from '@atcute/lexicons';
import { isBlob } from '@atcute/lexicons/interfaces';

import type { Embed } from './convert/embeds.ts';
import type { DocumentRecord } from './convert/record.ts';

/**
 * Is the note at `path` inside `folder` (or a subfolder of it)? Paths are
 * vault-relative with `/` separators. A trailing `/` on `folder` doesn't
 * matter. A folder must match whole path segments: `articles-old/a.md` is not
 * in `articles`. An empty folder means "anywhere in the vault".
 */
export function isInFolder(path: string, folder: string): boolean {
	const cleaned = folder.replace(/\/+$/, '');
	if (cleaned === '') return true;
	if (path.startsWith(`${cleaned}/`)) return true;
	return false;
}

/** `at://<did>/site.standard.document/<rkey>` */
export function documentUri(did: string, rkey: string): string {
	return `at://${did}/site.standard.document/${rkey}`;
}

/**
 * The record key (last path segment) of a document AT-URI. The URI has
 * already been validated by `parseDocumentMeta`.
 */
export function rkeyOf(uri: string): string {
	return /^at:\/\/[^\/]+\/site\.standard\.document\/([^\/]+)/.exec(uri)?.[1] ?? ''; 
}

/**
 * The distinct image targets to upload, in the order they first appear. An
 * image embedded twice is uploaded once.
 */
export function imageTargets(embeds: Embed[]): string[] {
	const seen = new Set<string>();
	for (const embed of embeds) {
		if (embed.kind !== 'image') continue;
		if (seen.has(embed.target)) continue;
		seen.add(embed.target);
	}
	return [...seen]
}

/** What an embed resolved to: the uploaded image's blob URL, or a published note's page URL. */
export interface EmbedTarget {
	url?: string;
}

/**
 * The GFM that replaces an embed, plus a warning for the author when
 * something couldn't be published as it looks in Obsidian.
 *
 * - `image` with a URL → `![alt](url)`. Without one → its alt text and a
 *   warning naming the image (it couldn't be uploaded).
 * - `link` with a URL → `[text](url)`. Without one (the note isn't published,
 *   or it's an obsidian:// link) → just the text, no warning.
 * - `file` → just its text, and a warning naming the file: only images are
 *   published.
 *
 * Text and alt text go inside `[…]`, so escape `\`, `[` and `]` with a
 * backslash.
 */
export function renderEmbed(embed: Embed, target: EmbedTarget): { markdown: string; warning?: string } {
	switch (embed.kind) {
		case 'image':
			if (target.url) return { markdown: `![${escapeLinkText(embed.alt)}](${target.url})` };
			return {
				markdown: escapeLinkText(embed.alt),
				warning: `"${embed.target}" couldn't be uploaded, so only its alt text was published.`,
			};
		case 'link':
			return { markdown: target.url ? `[${escapeLinkText(embed.text)}](${target.url})` : escapeLinkText(embed.text) };
		case 'file':
			return {
				markdown: escapeLinkText(embed.text),
				warning: `"${embed.target}" was left out: only images can be published.`,
			};
	}
}

/** Text that goes inside `[…]`: backslash-escape `\`, `[` and `]` so it can't end the link early. */
function escapeLinkText(text: string): string {
	return text.replace(/[\\[\]]/g, '\\$&');
}

export interface PublishedInfo {
	uri: string;
	slug: string;
	/** The record's `publishedAt` (kept from the first publish). */
	publishedAt: string;
	/** When this publish happened. */
	updatedAt: string;
	/** `fingerprint` of the note as it was published. */
	hash: string;
}

/**
 * Records a successful publish in the note's frontmatter (the object
 * `processFrontMatter` hands you, modified in place): `atproto_uri`, `slug`,
 * `published`, `updated`, `published_hash`. Other properties are untouched.
 */
export function markPublished(frontmatter: Record<string, unknown>, info: PublishedInfo): void {
	frontmatter.atproto_uri = info.uri;
	frontmatter.slug = info.slug;
	frontmatter.published = info.publishedAt;
	frontmatter.updated = info.updatedAt;
	frontmatter.published_hash = info.hash;
}

/**
 * Clears the link to the record after unpublishing: removes `atproto_uri`,
 * `published`, `updated` and `published_hash`. **Keeps `slug`**, so
 * republishing uses the same URL. Other properties are untouched.
 */
export function markUnpublished(frontmatter: Record<string, unknown>): void {
	delete frontmatter.atproto_uri;
	delete frontmatter.published;
	delete frontmatter.updated;
	delete frontmatter.published_hash;
}

/**
 * The CID a PDS will give these bytes when they're uploaded as a blob
 * (CIDv1, raw codec, sha2-256). Lets the plugin tell whether an image is
 * already on the record without uploading it.
 */
export async function blobCid(bytes: Uint8Array): Promise<string> {
	return cidToString(await createCid(CODEC_RAW, bytes));
}

/**
 * The blob already on the existing record (an inline image or the cover) with
 * this CID, reusable as-is instead of uploading the same bytes again.
 * Re-uploading an existing blob also leaves an orphaned temporary copy in the
 * PDS's blob storage.
 */
export function reusableBlob(
	existing: Pick<DocumentRecord, 'imageBlobs' | 'coverImage'> | undefined,
	cid: string,
): Blob | undefined {
	const candidates = [existing?.coverImage, ...(existing?.imageBlobs ?? []).map((entry) => entry.image)];
	return candidates.find((blob): blob is Blob => isBlob(blob) && blob.ref.$link === cid);
}

/**
 * Would writing `next` change the record already on the PDS? Compares
 * everything except `updatedAt` (which only says when it was last written),
 * ignoring key order, since the PDS may return keys in a different order than
 * they were sent.
 */
export function sameDocument(existing: object, next: object): boolean {
	const { updatedAt: _existingUpdatedAt, ...a } = existing as Record<string, unknown>;
	const { updatedAt: _nextUpdatedAt, ...b } = next as Record<string, unknown>;
	return deepEqual(a, b);
}

/** Structural equality for JSON data: arrays in order, objects regardless of key order. */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
	}
	const objectA = a as Record<string, unknown>;
	const objectB = b as Record<string, unknown>;
	// A key set to undefined isn't sent as JSON, so it's the same as no key.
	const keysA = Object.keys(objectA).filter((key) => objectA[key] !== undefined);
	const keysB = Object.keys(objectB).filter((key) => objectB[key] !== undefined);
	return keysA.length === keysB.length && keysA.every((key) => deepEqual(objectA[key], objectB[key]));
}
