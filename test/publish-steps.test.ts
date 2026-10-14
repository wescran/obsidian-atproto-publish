import { describe, expect, it } from 'vitest';

import type { Embed } from '../src/convert/embeds.ts';
import {
	documentUri,
	imageTargets,
	isInFolder,
	markPublished,
	markUnpublished,
	renderEmbed,
	rkeyOf,
} from '../src/publish-steps.ts';

const DID = 'did:plc:abc123';
const RKEY = '3mxd2abcdef22';
const URI = `at://${DID}/site.standard.document/${RKEY}`;
const BLOB = 'https://pds.example/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc123&cid=bafkrei';

const image = (target: string, alt = ''): Embed => ({ kind: 'image', target, alt, raw: `![[${target}]]` });
const link = (target: string, text = target): Embed => ({ kind: 'link', target, text, raw: `[[${target}]]` });
const fileEmbed = (target: string, text = target): Embed => ({ kind: 'file', target, text, raw: `![[${target}]]` });

describe('isInFolder', () => {
	it.each([
		['articles/welcome.md', 'articles', true],
		['articles/2026/welcome.md', 'articles', true],
		['articles/welcome.md', 'articles/', true],
		['writing/articles/welcome.md', 'writing/articles', true],
		['welcome.md', 'articles', false],
		['articles-old/welcome.md', 'articles', false],
		['other/articles/welcome.md', 'articles', false],
		['welcome.md', '', true],
		['deep/in/the/vault.md', '', true],
	])('%s in %j → %s', (path, folder, expected) => {
		expect(isInFolder(path, folder)).toBe(expected);
	});
});

describe('documentUri and rkeyOf', () => {
	it('builds a document AT-URI', () => {
		expect(documentUri(DID, RKEY)).toBe(URI);
	});

	it('takes the record key back out', () => {
		expect(rkeyOf(URI)).toBe(RKEY);
	});
});

describe('imageTargets', () => {
	it('lists each image once, in order of first appearance', () => {
		const embeds = [image('b.png'), link('Note'), image('a.png'), image('b.png', 'again'), fileEmbed('doc.pdf')];
		expect(imageTargets(embeds)).toEqual(['b.png', 'a.png']);
	});

	it('is empty when there are no images', () => {
		expect(imageTargets([link('Note')])).toEqual([]);
	});
});

describe('renderEmbed', () => {
	it('turns an uploaded image into Markdown', () => {
		expect(renderEmbed(image('cat.png', 'A cat'), { url: BLOB })).toEqual({ markdown: `![A cat](${BLOB})` });
	});

	it('escapes brackets and backslashes in alt text', () => {
		expect(renderEmbed(image('x.png', 'a [b] \\c'), { url: BLOB }).markdown).toBe(`![a \\[b\\] \\\\c](${BLOB})`);
	});

	it('warns about an image without a URL, keeping its alt text', () => {
		const result = renderEmbed(image('cat.png', 'A cat'), {});
		expect(result.markdown).toBe('A cat');
		expect(result.warning).toContain('cat.png');
	});

	it('links to a published note', () => {
		expect(renderEmbed(link('Other note', 'this'), { url: 'https://cranlab.ca/articles/other' })).toEqual({
			markdown: '[this](https://cranlab.ca/articles/other)',
		});
	});

	it('leaves an unpublished note as plain text, without a warning', () => {
		expect(renderEmbed(link('Draft note', 'a draft'), {})).toEqual({ markdown: 'a draft' });
	});

	it('escapes brackets in plain link text too', () => {
		expect(renderEmbed(link('x', '[1]'), {}).markdown).toBe('\\[1\\]');
	});

	it('leaves out other files, with a warning naming them', () => {
		const result = renderEmbed(fileEmbed('doc.pdf', 'The PDF'), {});
		expect(result.markdown).toBe('The PDF');
		expect(result.warning).toContain('doc.pdf');
	});
});

describe('markPublished', () => {
	const info = {
		uri: URI,
		slug: 'welcome',
		publishedAt: '2026-09-28T00:00:00.000Z',
		updatedAt: '2026-10-13T12:00:00.000Z',
		hash: 'ab12',
	};

	it('records the link to the record', () => {
		const frontmatter: Record<string, unknown> = { title: 'Welcome', tags: ['writing'] };
		markPublished(frontmatter, info);
		expect(frontmatter).toEqual({
			title: 'Welcome',
			tags: ['writing'],
			atproto_uri: URI,
			slug: 'welcome',
			published: '2026-09-28T00:00:00.000Z',
			updated: '2026-10-13T12:00:00.000Z',
			published_hash: 'ab12',
		});
	});

	it('overwrites values from an earlier publish', () => {
		const frontmatter: Record<string, unknown> = { title: 'X', updated: 'old', published_hash: 'old' };
		markPublished(frontmatter, info);
		expect(frontmatter.updated).toBe(info.updatedAt);
		expect(frontmatter.published_hash).toBe('ab12');
	});
});

describe('markUnpublished', () => {
	it('clears the link but keeps the slug and everything else', () => {
		const frontmatter: Record<string, unknown> = {
			title: 'Welcome',
			atproto_uri: URI,
			slug: 'welcome',
			published: '2026-09-28T00:00:00.000Z',
			updated: '2026-10-13T12:00:00.000Z',
			published_hash: 'ab12',
		};
		markUnpublished(frontmatter);
		expect(frontmatter).toEqual({ title: 'Welcome', slug: 'welcome' });
	});

	it('is harmless on a note that was never published', () => {
		const frontmatter: Record<string, unknown> = { title: 'Draft' };
		markUnpublished(frontmatter);
		expect(frontmatter).toEqual({ title: 'Draft' });
	});
});
