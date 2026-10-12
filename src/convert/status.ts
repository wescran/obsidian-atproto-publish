import type { DocumentMeta } from './document.ts';

export type PublishStatus = 'draft' | 'published' | 'modified';

/**
 * A fingerprint of what gets published from a note: SHA-256 (hex) of a
 * canonical JSON string of `{ title, description, tags, slug, date, cover, body }`.
 *
 * - Use Web Crypto (`crypto.subtle.digest('SHA-256', …)`): it exists in Node
 *   and in Obsidian, desktop and mobile.
 * - Canonical: fixed key order, absent values omitted, so the same content
 *   always gives the same hash however the object was built.
 * - `uri` and `publishedHash` are *not* included: writing them back to
 *   frontmatter after publishing must not make the note look edited.
 */
export async function fingerprint(meta: DocumentMeta, body: string): Promise<string> {
	const record = {
		title: meta.title,
		description: meta.description,
		tags: meta.tags,
		slug: meta.slug,
		date: meta.date,
		cover: meta.cover,
		body: body,
	}
	const msg = new TextEncoder().encode(JSON.stringify(record));
	const hash = await crypto.subtle.digest('SHA-256', msg);
	const hashArray = Array.from(new Uint8Array(hash));

	return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * - No `meta.uri` → `draft`.
 * - `meta.publishedHash === currentHash` → `published`.
 * - Otherwise (edited since, or published before hashes existed) → `modified`.
 */
export function publishStatus(meta: DocumentMeta, currentHash: string): PublishStatus {
	if (!meta.uri) return 'draft';
	if (meta.publishedHash === currentHash) return 'published';
	return 'modified';
}
