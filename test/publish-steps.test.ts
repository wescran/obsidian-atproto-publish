import { describe, expect, it } from 'vitest';

import type { Embed } from '../src/convert/embeds.ts';
import {
	blobCid,
	documentUri,
	imageTargets,
	isInFolder,
	markPublished,
	markUnpublished,
	renderEmbed,
	reusableBlob,
	rkeyOf,
	sameDocument,
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

describe('blobCid', () => {
	it('computes the CID a PDS gives the same bytes (CIDv1, raw, sha2-256)', async () => {
		// Expected values computed independently (Node's crypto + base32), and the same
		// algorithm matched a real PDS-assigned CID for an image in the dev vault.
		expect(await blobCid(new TextEncoder().encode('cover'))).toBe(
			'bafkreib7uqc2qma2zy2nchhujkawbafy6dsjush32belrlxrkq5iywf5wy',
		);
		expect(await blobCid(new TextEncoder().encode('image'))).toBe(
			'bafkreidbaxlmy5vpiabsl2knlcgoken6lp63w45ug7ofd3fehel5pjb6hu',
		);
	});
});

describe('reusableBlob', () => {
	const blobOf = (cid: string, mimeType = 'image/png') => ({
		$type: 'blob' as const,
		ref: { $link: cid },
		mimeType,
		size: 10,
	});
	const ONE = 'bafkreidwslb22nkaxoadyaqlhlxgntmiq4jdenhkbrxhcq6avxlt75br5u';
	const TWO = 'bafkreib7ytgp45cyodrmbwm7ohzq74dfnsg63va4yhl5hu3wwdn6nbpc6m';
	const COVER = 'bafkreib7uqc2qma2zy2nchhujkawbafy6dsjush32belrlxrkq5iywf5wy';
	const existing = {
		imageBlobs: [{ image: blobOf(ONE) }, { image: blobOf(TWO, 'image/jpeg'), alt: 'two' }],
		coverImage: blobOf(COVER, 'image/webp'),
	};

	it('finds an inline image already on the record, returning its whole blob', () => {
		expect(reusableBlob(existing, TWO)).toEqual(blobOf(TWO, 'image/jpeg'));
	});

	it('finds the cover image', () => {
		expect(reusableBlob(existing, COVER)).toEqual(blobOf(COVER, 'image/webp'));
	});

	it('returns undefined for an image the record does not have', () => {
		expect(reusableBlob(existing, 'bafkreiglubvvonx26z7fjmd3kypk5fbzlz3uyul2pwiquvbwtyjghth32q')).toBeUndefined();
	});

	it('returns undefined when there is no existing record, or it has no images', () => {
		expect(reusableBlob(undefined, ONE)).toBeUndefined();
		expect(reusableBlob({}, ONE)).toBeUndefined();
	});
});

describe('sameDocument', () => {
	const base = {
		$type: 'site.standard.document',
		path: '/articles/x',
		title: 'X',
		tags: ['a', 'b'],
		publishedAt: '2026-09-28T00:00:00.000Z',
		content: { $type: 'at.markpub.markdown', flavor: 'gfm', text: { $type: 'at.markpub.text', markdown: '# X' } },
		imageBlobs: [{ image: { $type: 'blob', ref: { $link: 'bafkreione' }, mimeType: 'image/png', size: 10 } }],
	};
	const clone = () => structuredClone(base) as Record<string, unknown>;

	it('is true for identical records', () => {
		expect(sameDocument(base, clone())).toBe(true);
	});

	it('ignores key order, at every level', () => {
		const reordered = {
			imageBlobs: [{ image: { size: 10, mimeType: 'image/png', ref: { $link: 'bafkreione' }, $type: 'blob' } }],
			content: { text: { markdown: '# X', $type: 'at.markpub.text' }, flavor: 'gfm', $type: 'at.markpub.markdown' },
			publishedAt: '2026-09-28T00:00:00.000Z',
			tags: ['a', 'b'],
			title: 'X',
			path: '/articles/x',
			$type: 'site.standard.document',
		};
		expect(sameDocument(base, reordered)).toBe(true);
	});

	it('ignores updatedAt, which only says when it was last written', () => {
		expect(
			sameDocument(
				{ ...base, updatedAt: '2026-10-01T00:00:00.000Z' },
				{ ...clone(), updatedAt: '2026-10-17T00:00:00.000Z' },
			),
		).toBe(true);
		expect(sameDocument({ ...base, updatedAt: '2026-10-01T00:00:00.000Z' }, clone())).toBe(true);
	});

	it.each([
		['the body', (d: Record<string, unknown>) => ((d.content as { text: { markdown: string } }).text.markdown = '# Y')],
		['the title', (d: Record<string, unknown>) => (d.title = 'Y')],
		['the publish date', (d: Record<string, unknown>) => (d.publishedAt = '2026-09-29T00:00:00.000Z')],
		['the order of tags', (d: Record<string, unknown>) => (d.tags = ['b', 'a'])],
		[
			'an image',
			(d: Record<string, unknown>) =>
				((d.imageBlobs as Array<{ image: { ref: { $link: string } } }>)[0]!.image.ref.$link = 'bafkreitwo'),
		],
		['an added field', (d: Record<string, unknown>) => (d.description = 'New.')],
		['a removed field', (d: Record<string, unknown>) => delete d.tags],
	])('is false when %s changed', (_change, change) => {
		const changed = clone();
		change(changed);
		expect(sameDocument(base, changed)).toBe(false);
	});

	it('ignores keys set to undefined, which are dropped when the record is sent as JSON', () => {
		expect(sameDocument(base, { ...clone(), coverImage: undefined })).toBe(true);
	});

	it('does not treat an empty list and an empty object as the same', () => {
		expect(sameDocument({ ...base, tags: [] }, { ...clone(), tags: {} })).toBe(false);
	});
});
