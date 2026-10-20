/** Pure decisions for the publish and unpublish commands. */
import { CODEC_RAW, create as createCid, toString as cidToString } from '@atcute/cid';
import type { Blob } from '@atcute/lexicons';
import { isBlob } from '@atcute/lexicons/interfaces';

import type { Embed } from './convert/embeds.ts';
import type { DocumentRecord } from './convert/record.ts';

/** Whether `path` is inside `folder` or a subfolder. An empty folder matches everything. */
export function isInFolder(path: string, folder: string): boolean {
	const cleaned = folder.replace(/\/+$/, '');
	return cleaned === '' || path.startsWith(`${cleaned}/`);
}

export function documentUri(did: string, rkey: string): string {
	return `at://${did}/site.standard.document/${rkey}`;
}

/** The record key of an already validated document AT-URI. */
export function rkeyOf(uri: string): string {
	return /^at:\/\/[^/]+\/site\.standard\.document\/([^/]+)/.exec(uri)?.[1] ?? '';
}

/** Distinct image targets, in order of first appearance. */
export function imageTargets(embeds: Embed[]): string[] {
	const targets = new Set<string>();
	for (const embed of embeds) {
		if (embed.kind === 'image') targets.add(embed.target);
	}
	return [...targets];
}

/** Where an embed resolved to, if anywhere. */
export interface EmbedTarget {
	url?: string;
}

/**
 * The GFM that replaces an embed. Unresolved links become plain text; missing
 * images and non-image files also produce a warning.
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

/** Escapes `\`, `[` and `]` so text can't end a link early. */
function escapeLinkText(text: string): string {
	return text.replace(/[\\[\]]/g, '\\$&');
}

export interface PublishedInfo {
	uri: string;
	slug: string;
	publishedAt: string;
	updatedAt: string;
	/** `fingerprint` of the note as published. */
	hash: string;
}

/** Records a successful publish in the frontmatter, in place. */
export function markPublished(frontmatter: Record<string, unknown>, info: PublishedInfo): void {
	frontmatter.atproto_uri = info.uri;
	frontmatter.slug = info.slug;
	frontmatter.published = info.publishedAt;
	frontmatter.updated = info.updatedAt;
	frontmatter.published_hash = info.hash;
}

/** Clears the link to the record. Keeps `slug`, so republishing reuses the URL. */
export function markUnpublished(frontmatter: Record<string, unknown>): void {
	delete frontmatter.atproto_uri;
	delete frontmatter.published;
	delete frontmatter.updated;
	delete frontmatter.published_hash;
}

/** The CID a PDS assigns these bytes as a blob (CIDv1, raw, sha2-256). */
export async function blobCid(bytes: Uint8Array): Promise<string> {
	return cidToString(await createCid(CODEC_RAW, bytes));
}

/**
 * The blob with this CID already on the record, if any. Re-uploading it would
 * leave an orphaned temporary copy in the PDS's blob storage.
 */
export function reusableBlob(
	existing: Pick<DocumentRecord, 'imageBlobs' | 'coverImage'> | undefined,
	cid: string,
): Blob | undefined {
	const candidates = [existing?.coverImage, ...(existing?.imageBlobs ?? []).map((entry) => entry.image)];
	return candidates.find((blob): blob is Blob => isBlob(blob) && blob.ref.$link === cid);
}

/** Whether writing `next` would change the record, ignoring `updatedAt` and key order. */
export function sameDocument(existing: object, next: object): boolean {
	const { updatedAt: _existingUpdatedAt, ...a } = existing as Record<string, unknown>;
	const { updatedAt: _nextUpdatedAt, ...b } = next as Record<string, unknown>;
	return deepEqual(a, b);
}

/** Structural equality for JSON data. */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
	}
	const objectA = a as Record<string, unknown>;
	const objectB = b as Record<string, unknown>;
	// Undefined values aren't serialized, so they count as missing keys.
	const keysA = Object.keys(objectA).filter((key) => objectA[key] !== undefined);
	const keysB = Object.keys(objectB).filter((key) => objectB[key] !== undefined);
	return keysA.length === keysB.length && keysA.every((key) => deepEqual(objectA[key], objectB[key]));
}
