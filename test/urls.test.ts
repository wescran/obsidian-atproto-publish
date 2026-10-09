import { describe, expect, it } from 'vitest';

import { blobUrl, expandPath, joinUrl } from '../src/urls.ts';

describe('expandPath', () => {
	it('replaces {slug} in the template', () => {
		expect(expandPath('/articles/{slug}', 'welcome')).toBe('/articles/welcome');
	});

	it('works with the default root template', () => {
		expect(expandPath('/{slug}', 'welcome')).toBe('/welcome');
	});

	it('adds a missing leading slash and drops a trailing one', () => {
		expect(expandPath('articles/{slug}/', 'welcome')).toBe('/articles/welcome');
	});

	it('rejects a template without {slug}', () => {
		expect(() => expandPath('/articles/', 'welcome')).toThrow('{slug}');
	});
});

describe('joinUrl', () => {
	it('joins a site URL and a path', () => {
		expect(joinUrl('https://cranlab.ca', '/articles/welcome')).toBe('https://cranlab.ca/articles/welcome');
	});

	it('trims a trailing slash from the site URL', () => {
		expect(joinUrl('https://cranlab.ca/', '/articles/welcome')).toBe('https://cranlab.ca/articles/welcome');
	});
});

describe('blobUrl', () => {
	it('builds an encoded com.atproto.sync.getBlob URL', () => {
		expect(blobUrl('https://weslandia.ca', 'did:plc:abc', 'bafkrei123')).toBe(
			'https://weslandia.ca/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc&cid=bafkrei123',
		);
	});
});
