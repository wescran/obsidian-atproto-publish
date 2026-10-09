const SLUG = '{slug}';

/** Turns a path template like `/articles/{slug}` into a document path. */
export function expandPath(template: string, slug: string): string {
	if (!template.includes(SLUG)) {
		throw new Error(`Path template must contain ${SLUG}: ${template}`);
	}
	const path = template.replace(SLUG, slug).replace(/\/+$/, '');
	return path.startsWith('/') ? path : `/${path}`;
}

export function joinUrl(siteUrl: string, path: string): string {
	return `${siteUrl.replace(/\/+$/, '')}${path}`;
}

export function blobUrl(service: string, did: string, cid: string): string {
	const query = new URLSearchParams({ did, cid });
	return `${service.replace(/\/+$/, '')}/xrpc/com.atproto.sync.getBlob?${query}`;
}
