/**
 * The decisions the publish and unpublish commands make, kept free of
 * Obsidian and the network so they can be unit-tested. `publisher.ts` does
 * the reading, uploading and writing around them.
 */
import type { Embed } from './convert/embeds.ts';

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
