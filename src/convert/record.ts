import type { Blob } from '@atcute/lexicons';
import type { SiteStandardDocument } from '@atcute/standard-site';

import type { AtMarkpubMarkdown } from '../lexicons/index.ts';
import type { DocumentMeta } from './document.ts';

/** An uploaded image, listed on the record so the PDS keeps the blob. */
export interface ImageBlob {
	image: Blob;
	alt?: string;
}

/** `at.markpub.markdown`, the content this plugin writes. */
export type MarkpubContent = AtMarkpubMarkdown.Main & { $type: 'at.markpub.markdown' };

/**
 * A `site.standard.document` plus this plugin's one extension field.
 *
 * `content` is an open union in the lexicon with no listed members, which the
 * generated type turns into `undefined`. Records written by this plugin hold
 * Markpub; records written by other apps may hold any `$type`.
 */
export type DocumentRecord = Omit<SiteStandardDocument.Main, 'content'> & {
	content?: MarkpubContent | { $type: string };
	imageBlobs?: ImageBlob[];
};

export interface BuildInput {
	meta: DocumentMeta;
	/** Already expanded from the path template, e.g. `/articles/welcome`. */
	path: string;
	/** GFM body, after `toGfm` and `replaceEmbeds`. */
	markdown: string;
	/** `toPlainText(markdown)` */
	plainText: string;
	/** From `toGfm`: declare the LaTeX extension. */
	hasMath: boolean;
	publicationUri: string;
	images: ImageBlob[];
	coverImage?: Blob;
	/** Current time, ISO 8601. Passed in so tests are deterministic. */
	now: string;
}

/**
 * Builds the record for a note.
 *
 * Rules:
 * - `$type: 'site.standard.document'`, `site: publicationUri`, `path`, `title`.
 * - `description` only when `meta.description` is set.
 * - `tags` only when non-empty.
 * - `publishedAt`: `meta.date ?? now`. No `updatedAt` (see `mergeForUpdate`).
 * - `textContent: plainText`.
 * - `content`: `{ $type: 'at.markpub.markdown', flavor: 'gfm', text: { $type: 'at.markpub.text', markdown } }`,
 *   plus `extensions: ['LaTeX']` when `hasMath`.
 * - `coverImage` only when given. `imageBlobs` only when `images` is non-empty.
 */
export function buildDocument(input: BuildInput): DocumentRecord {
	const markdown: MarkpubContent = { $type: 'at.markpub.markdown', flavor: 'gfm', text: { $type: 'at.markpub.text', markdown: input.markdown } };
	if (input.hasMath) markdown.extensions = ['LaTeX'];

	const record: DocumentRecord = {
		$type: 'site.standard.document',
		site: input.publicationUri as DocumentRecord['site'],
		title: input.meta.title,
		publishedAt: input.meta.date ?? input.now,
		path: input.path,
		textContent: input.plainText,
		content: markdown,
	};
	if (input.meta.description) record.description = input.meta.description;
	if (input.meta.tags.length > 0) record.tags = input.meta.tags;
	if (input.coverImage) record.coverImage = input.coverImage;
	if (input.images.length > 0) record.imageBlobs = input.images;
	
	return record;
}

/** Fields this plugin writes. Anything else on an existing record belongs to someone else. */
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
 * Combines the record already on the PDS with a freshly built one.
 *
 * Rules:
 * - No `existing` → return `next` unchanged.
 * - Fields in `OWNED_FIELDS` come from `next` (and are removed when `next`
 *   doesn't have them, e.g. a deleted description).
 * - Every other field on `existing` is kept: `bskyPostRef` (set by the site
 *   when it announces the document), `contributors`, `labels`, other apps'
 *   extension fields, …
 * - `publishedAt`: the note's `date` when it has one (so a date can be added
 *   or corrected after the first publish), otherwise the existing one.
 * - `updatedAt`: `now`.
 */
export function mergeForUpdate(
	existing: DocumentRecord | undefined,
	next: DocumentRecord,
	update: { now: string; date?: string },
): DocumentRecord {
	if (!existing) {
		return next;
	}
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
	| { kind: 'ok' }
	| { kind: 'relink'; uri: string; title: string }
	| { kind: 'conflict'; uri: string; title: string };

/**
 * Is `path` free for this note? `isClaimed(uri)` says whether another note in
 * the vault links to that record (has it as its `atproto_uri`).
 *
 * - No other record has `path`, or the one that does is `ownUri` → `ok`.
 * - The note has no `ownUri` yet, a record has `path`, and no note claims
 *   that record → `relink` to it (the note probably lost its `atproto_uri`).
 * - Otherwise (the note has a different `ownUri`, or another note still links
 *   to the record) → `conflict`.
 *
 * `relink` and `conflict` carry the record's `title` (trimmed; its path when
 * it has none), so messages can name the document the way the author knows it.
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
