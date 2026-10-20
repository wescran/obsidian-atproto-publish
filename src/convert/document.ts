import { slugify } from './slug.ts';

/** An error whose message is shown to the author as-is. */
export class PublishError extends Error {
	override name = 'PublishError';
}

/** A note's frontmatter, validated and normalised. */
export interface DocumentMeta {
	title: string;
	description?: string;
	tags: string[];
	/** Pinned on first publish; until then derived from the file name. */
	slug: string;
	/** ISO 8601. */
	date?: string;
	/** Link text of the cover image, without `[[ ]]`. */
	cover?: string;
	/** From `atproto_uri`. */
	uri?: string;
	/** From `published_hash`. */
	publishedHash?: string;
}

/** Accepts text `"true"`/`"false"` too, which Obsidian writes for a Text-typed property. */
function isDraft(value: unknown): boolean {
	if (typeof value === 'boolean') return value;
	if (value === undefined || value === null) return false;
	const text = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
	if (text === 'true') return true;
	if (text === 'false' || text === '') return false;
	throw new PublishError(
		'"draft" should be a checkbox (true or false). In the Properties panel, change its type to Checkbox.',
	);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value.trim() : undefined;
}

/** A note's `atproto_uri`, validated without applying the publishing rules (for unpublish). */
export function parseDocumentUri(value: unknown): string | undefined {
	const uri = optionalString(value);
	if (!uri) return undefined;
	if (!/^at:\/\/did:[^/]+\/site\.standard\.document\/[^/]+$/.test(uri)) {
		throw new PublishError(
			`"atproto_uri" (${uri}) isn't a link to a standard.site document. Remove it to publish this note as a new document.`,
		);
	}
	return uri;
}

/**
 * Validates a note's frontmatter, throwing a `PublishError` that says what to
 * fix. The title falls back to the file name, as in Obsidian. Empty optional
 * fields are omitted rather than set to `undefined`.
 */
export function parseDocumentMeta(frontmatter: Record<string, unknown> | undefined, basename: string): DocumentMeta {
	const fm = frontmatter ?? {};
	if (isDraft(fm.draft))
		throw new PublishError('This note is marked "draft: true". Remove it, or set it to false, to publish.');

	const title = optionalString(fm.title) || basename.trim();
	if (!title) throw new PublishError('Add a "title" property to publish this note.');

	const tags = new Set<string>();
	for (const item of Array.isArray(fm.tags) ? fm.tags : [fm.tags]) {
		const tag = optionalString(item)?.replace(/^#/, '');
		if (tag) tags.add(tag);
	}

	const rawSlug = optionalString(fm.slug);
	const slug = slugify(rawSlug || basename);
	if (slug === '') {
		throw new PublishError(
			`Can't make a URL slug from "${rawSlug || basename}". Add a "slug" property using letters or numbers, e.g. slug: my-post.`,
		);
	}

	const docMeta: DocumentMeta = { title, slug, tags: [...tags] };

	const description = optionalString(fm.description);
	if (description) docMeta.description = description;

	// An empty property is null. A bare year is a number in YAML, so it's refused.
	if (fm.date !== undefined && fm.date !== null) {
		const rawDate = typeof fm.date === 'string' || fm.date instanceof Date ? new Date(fm.date) : undefined;
		if (!rawDate || Number.isNaN(rawDate.getTime())) {
			throw new PublishError(`Can't read the date "${String(fm.date)}". Use a date like 2026-09-28.`);
		}
		docMeta.date = rawDate.toISOString();
	}

	// Link properties are stored as `[[target|alias]]`.
	const rawCover = optionalString(fm.cover);
	if (rawCover) docMeta.cover = rawCover.replace(/^!?\[\[([^|\]]*)(?:\|[^\]]*)?\]\]$/, '$1');

	const uri = parseDocumentUri(fm.atproto_uri);
	if (uri) docMeta.uri = uri;

	const rawPubHash = optionalString(fm.published_hash);
	if (rawPubHash) docMeta.publishedHash = rawPubHash;

	return docMeta;
}
