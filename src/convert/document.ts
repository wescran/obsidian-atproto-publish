import { string } from '@atcute/lexicons/validations';
import { slugify } from './slug.ts';

/** An error whose message is shown to the author as-is. */
export class PublishError extends Error {
	override name = 'PublishError';
}

/** What the plugin needs from a note's frontmatter, validated and normalised. */
export interface DocumentMeta {
	title: string;
	description?: string;
	tags: string[];
	/** Pinned in frontmatter on first publish; until then derived from the file name. */
	slug: string;
	/** ISO 8601 (`toISOString()`), from frontmatter `date`. */
	date?: string;
	/** Vault path or link text of the cover image, without `[[ ]]`. */
	cover?: string;
	/** `atproto_uri`: the note's record, once published. */
	uri?: string;
	/** `published_hash`: fingerprint of what was last published. */
	publishedHash?: string;
}

function optionalString(val: unknown): string | undefined {
	if (typeof val === 'string') return val.trim();
	return undefined;
}
/**
 * Reads a note's frontmatter (Obsidian's parsed properties, so values are
 * `unknown`) into a `DocumentMeta`, or throws a `PublishError` explaining what
 * to fix.
 *
 * Rules:
 * - `title`: required, a non-empty string after trimming. Error mentions `title`.
 * - `draft: true` → error mentioning `draft`.
 * - `description`: optional string, trimmed. Omit it when empty.
 * - `tags`: a list or a single string. Trim each, strip a leading `#`, drop
 *   empty and non-string entries, remove duplicates (keep first). Missing → `[]`.
 * - `slug`: `slugify(frontmatter.slug)` when it's a non-empty string,
 *   otherwise `slugify(basename)`. An empty result → error mentioning `slug`.
 * - `date`: optional string (or `Date`). Must parse with `new Date(…)`;
 *   store `toISOString()`. Unparseable, or any other type (e.g. a bare year,
 *   which YAML reads as a number) → error mentioning `date`. `null` (an empty
 *   property) means no date.
 * - `cover`: optional string. Strip a surrounding `[[…]]` (Obsidian stores
 *   link properties that way), a leading `!`, and a `|display text` alias.
 * Error messages are shown to the author in a notice: plain text, saying what
 * to change.
 * - `atproto_uri`: optional. When present it must look like
 *   `at://<did>/site.standard.document/<rkey>`; otherwise error mentioning
 *   `atproto_uri`.
 * - `published_hash`: optional string → `publishedHash`.
 * Keys that are absent/empty must be *absent* from the result (not `undefined`).
 */
export function parseDocumentMeta(frontmatter: Record<string, unknown> | undefined, basename: string): DocumentMeta {
	const fm = frontmatter ?? {};
	if (fm.draft === true) throw new PublishError('This note is marked "draft: true". Remove it, or set it to false, to publish.');

	const title = optionalString(fm.title);
	if (!title) throw new PublishError('Add a "title" property to publish this note.');
	
	const tagList = Array.isArray(fm.tags) ? fm.tags : [fm.tags];
	const tagSet = new Set<string>();
	for (const item of tagList) {
		const stringItem = optionalString(item);
		if (stringItem === undefined) continue;
		const tag = stringItem.replace(/^#/, '');
		if (tag === '') continue;
		if (tagSet.has(tag)) continue;
		tagSet.add(tag);
	}
	const tags = [...tagSet];

	let slug: string;
	const rawSlug = optionalString(fm.slug);
	if (!rawSlug) {
		slug = slugify(basename);
	} else {
		slug = slugify(rawSlug);
	}
	if (slug === '') {
		throw new PublishError(
			`Can't make a URL slug from "${rawSlug || basename}". Add a "slug" property using letters or numbers, e.g. slug: my-post.`,
		);
	}


	const docMeta: DocumentMeta = {
		title: title,
		slug: slug,
		tags: tags,
	};

	const description = optionalString(fm.description);
	if (description) docMeta.description = description;
	
	if (fm.date !== undefined && fm.date !== null) {
		const rawDate = typeof fm.date === 'string' || fm.date instanceof Date ? new Date(fm.date) : undefined;
		if (!rawDate || Number.isNaN(rawDate.getTime())) {
			throw new PublishError(`Can't read the date "${String(fm.date)}". Use a date like 2026-09-28.`);
		}
		docMeta.date = rawDate.toISOString();
	}

	const rawCover = optionalString(fm.cover);
	if (rawCover) docMeta.cover = rawCover.replace(/^!?\[\[([^|\]]*)(?:\|[^\]]*)?\]\]$/, '$1');

	//at://<did>/site.standard.document/<rkey>
	const rawUri = optionalString(fm.atproto_uri);
	if (rawUri) {
		if (/^at:\/\/did:[^/]+\/site\.standard\.document\/[^/]+$/.test(rawUri)) {
			docMeta.uri = rawUri;
		} else {
			throw new PublishError(
				`"atproto_uri" (${rawUri}) isn't a link to a standard.site document. Remove it to publish this note as a new document.`,
			);
		}
	}

	const rawPubHash = optionalString(fm.published_hash);
	if (rawPubHash) docMeta.publishedHash = rawPubHash;

	return docMeta;
}
