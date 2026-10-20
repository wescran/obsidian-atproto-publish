import { type DocumentMeta, parseDocumentMeta, PublishError } from './document.ts';

export type PublishStatus = 'draft' | 'published' | 'modified';

/**
 * SHA-256 of what gets published from a note, in a fixed key order. Excludes
 * `uri` and `publishedHash`, so writing them back doesn't look like an edit.
 */
export async function fingerprint(meta: DocumentMeta, body: string): Promise<string> {
	const record = {
		title: meta.title,
		description: meta.description,
		tags: meta.tags,
		slug: meta.slug,
		date: meta.date,
		cover: meta.cover,
		body,
	};
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(record)));
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function publishStatus(meta: DocumentMeta, currentHash: string): PublishStatus {
	if (!meta.uri) return 'draft';
	if (meta.publishedHash === currentHash) return 'published';
	return 'modified';
}

/**
 * A note's current status. A note that can't be published as it is counts as
 * `modified` if it has a record, otherwise `draft`.
 */
export async function noteStatus(
	frontmatter: Record<string, unknown> | undefined,
	basename: string,
	body: string,
): Promise<PublishStatus> {
	let docMeta: DocumentMeta;
	try {
		docMeta = parseDocumentMeta(frontmatter, basename);
	} catch (error) {
		if (!(error instanceof PublishError)) throw error;
		const uri = frontmatter?.atproto_uri;
		return typeof uri === 'string' && uri.trim() ? 'modified' : 'draft';
	}
	return publishStatus(docMeta, await fingerprint(docMeta, body));
}

export function statusLabel(status: PublishStatus): string {
	switch (status) {
		case 'draft':
			return 'Draft';
		case 'published':
			return 'Published';
		case 'modified':
			return 'Published · edited';
	}
}
