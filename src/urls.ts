export function articlePath(slug: string): string {
	return `/articles/${slug}`;
}

export function articleUrl(siteUrl: string, slug: string): string {
	return `${siteUrl.replace(/\/+$/, '')}${articlePath(slug)}`;
}

export function blobUrl(service: string, did: string, cid: string): string {
	const query = new URLSearchParams({ did, cid });
	return `${service.replace(/\/+$/, '')}/xrpc/com.atproto.sync.getBlob?${query}`;
}
