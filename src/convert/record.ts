import type { Blob } from '@atcute/lexicons';
import type { SiteStandardDocument } from '@atcute/standard-site';

import type { AtMarkpubMarkdown } from '../lexicons/index.ts';
import type { DocumentMeta } from './document.ts';

/** Listed on the record so the PDS keeps the blob. */
export interface ImageBlob {
	image: Blob;
	alt?: string;
}

export type MarkpubContent = AtMarkpubMarkdown.Main & { $type: 'at.markpub.markdown' };

/**
 * A `site.standard.document` plus the `imageBlobs` extension. `content` is
 * retyped because the lexicon's open union generates as `undefined`.
 */
export type DocumentRecord = Omit<SiteStandardDocument.Main, 'content'> & {
	content?: MarkpubContent | { $type: string };
	imageBlobs?: ImageBlob[];
};

export interface BuildInput {
	meta: DocumentMeta;
	/** Expanded from the path template, e.g. `/articles/welcome`. */
	path: string;
	/** GFM body with embeds replaced. */
	markdown: string;
	plainText: string;
	/** Declares the LaTeX extension. */
	hasMath: boolean;
	publicationUri: string;
	images: ImageBlob[];
	coverImage?: Blob;
	/** ISO 8601; passed in so tests are deterministic. */
	now: string;
}

/** Builds a first-publish record; `mergeForUpdate` handles republishing. */
export function buildDocument(input: BuildInput): DocumentRecord {
	const content: MarkpubContent = {
		$type: 'at.markpub.markdown',
		flavor: 'gfm',
		text: { $type: 'at.markpub.text', markdown: input.markdown },
	};
	if (input.hasMath) content.extensions = ['LaTeX'];

	const record: DocumentRecord = {
		$type: 'site.standard.document',
		site: input.publicationUri as DocumentRecord['site'],
		title: input.meta.title,
		publishedAt: input.meta.date ?? input.now,
		path: input.path,
		textContent: input.plainText,
		content,
	};
	if (input.meta.description) record.description = input.meta.description;
	if (input.meta.tags.length > 0) record.tags = input.meta.tags;
	if (input.coverImage) record.coverImage = input.coverImage;
	if (input.images.length > 0) record.imageBlobs = input.images;
	return record;
}

/** Fields this plugin writes. Anything else on a record is preserved. */
export const OWNED_FIELDS = [
	'$type',
	'site',
	'path',
	'title',
	'description',
	'tags',
	'textContent',
	'content',
	'coverImage',
	'imageBlobs',
	'publishedAt',
	'updatedAt',
] as const;

/**
 * Combines the existing record with a freshly built one: owned fields come
 * from `next`, everything else (e.g. `bskyPostRef`) is kept. A note's `date`
 * overrides the existing `publishedAt`.
 */
export function mergeForUpdate(
	existing: DocumentRecord | undefined,
	next: DocumentRecord,
	update: { now: string; date?: string },
): DocumentRecord {
	if (!existing) return next;
	const owned = new Set<string>(OWNED_FIELDS);
	const kept = Object.fromEntries(Object.entries(existing).filter(([key]) => !owned.has(key)));
	return {
		...kept,
		...next,
		publishedAt: update.date ?? existing.publishedAt,
		updatedAt: update.now,
	} as DocumentRecord;
}

export type PathCheck =
	{ kind: 'ok' } | { kind: 'relink'; uri: string; title: string } | { kind: 'conflict'; uri: string; title: string };

/**
 * Whether `path` is free for this note. A note without a record may relink to
 * an existing one, unless another note in the vault (`isClaimed`) links to it.
 */
export function checkPath(
	records: Array<{ uri: string; value: { path?: string; title?: string } }>,
	path: string,
	ownUri: string | undefined,
	isClaimed: (uri: string) => boolean,
): PathCheck {
	const existing = records.find((record) => record.value.path === path && record.uri !== ownUri);
	if (!existing) return { kind: 'ok' };

	const title = existing.value.title?.trim() || path;
	if (ownUri === undefined && !isClaimed(existing.uri)) return { kind: 'relink', uri: existing.uri, title };
	return { kind: 'conflict', uri: existing.uri, title };
}
