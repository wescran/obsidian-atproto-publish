import { describe, expect, it } from 'vitest';

import { articlePath, articleUrl, blobUrl } from '../src/urls.ts';

describe('articlePath', () => {
	it('prefixes the slug with /articles/', () => {
		expect(articlePath('welcome')).toBe('/articles/welcome');
	});
});

describe('articleUrl', () => {
	it('joins the site URL and the article path', () => {
		expect(articleUrl('https://cranlab.ca', 'welcome')).toBe('https://cranlab.ca/articles/welcome');
	});

	it('trims a trailing slash from the site URL', () => {
		expect(articleUrl('https://cranlab.ca/', 'welcome')).toBe('https://cranlab.ca/articles/welcome');
	});
});

describe('blobUrl', () => {
	it('builds an encoded com.atproto.sync.getBlob URL', () => {
		expect(blobUrl('https://weslandia.ca', 'did:plc:abc', 'bafkrei123')).toBe(
			'https://weslandia.ca/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc&cid=bafkrei123',
		);
	});
});
