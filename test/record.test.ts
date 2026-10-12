import type { Blob } from '@atcute/lexicons';
import { is } from '@atcute/lexicons';
import { SiteStandardDocument } from '@atcute/standard-site';
import { describe, expect, it } from 'vitest';

import type { DocumentMeta } from '../src/convert/document.ts';
import { type BuildInput, buildDocument, checkPath, type DocumentRecord, mergeForUpdate } from '../src/convert/record.ts';

const PUBLICATION = 'at://did:plc:a/site.standard.publication/p1';
const NOW = '2026-10-07T12:00:00.000Z';

/** Real CIDs (sha2-256 of the names), because the schema validates them. */
const CID = {
	cover: 'bafkreib7uqc2qma2zy2nchhujkawbafy6dsjush32belrlxrkq5iywf5wy',
	image: 'bafkreidbaxlmy5vpiabsl2knlcgoken6lp63w45ug7ofd3fehel5pjb6hu',
	one: 'bafkreidwslb22nkaxoadyaqlhlxgntmiq4jdenhkbrxhcq6avxlt75br5u',
	two: 'bafkreib7ytgp45cyodrmbwm7ohzq74dfnsg63va4yhl5hu3wwdn6nbpc6m',
	old: 'bafkreiglubvvonx26z7fjmd3kypk5fbzlz3uyul2pwiquvbwtyjghth32q',
};

function blob(name: keyof typeof CID, mimeType = 'image/png'): Blob {
	return { $type: 'blob', ref: { $link: CID[name] }, mimeType, size: 1234 };
}

function input(overrides: Partial<BuildInput> = {}, meta: Partial<DocumentMeta> = {}): BuildInput {
	return {
		meta: { title: 'Welcome', tags: ['writing'], slug: 'welcome', ...meta },
		path: '/articles/welcome',
		markdown: '# Hi',
		plainText: 'Hi',
		hasMath: false,
		publicationUri: PUBLICATION,
		images: [],
		now: NOW,
		...overrides,
	};
}

describe('buildDocument', () => {
	it('builds a minimal document', () => {
		expect(buildDocument(input())).toEqual({
			$type: 'site.standard.document',
			site: PUBLICATION,
			path: '/articles/welcome',
			title: 'Welcome',
			tags: ['writing'],
			publishedAt: NOW,
			textContent: 'Hi',
			content: {
				$type: 'at.markpub.markdown',
				flavor: 'gfm',
				text: { $type: 'at.markpub.text', markdown: '# Hi' },
			},
		});
	});

	it('is a valid site.standard.document', () => {
		const record = buildDocument(input({ images: [{ image: blob('image') }], coverImage: blob('cover') }));
		expect(is(SiteStandardDocument.mainSchema, record)).toBe(true);
	});

	it('uses the frontmatter date as publishedAt', () => {
		expect(buildDocument(input({}, { date: '2026-09-28T00:00:00.000Z' })).publishedAt).toBe('2026-09-28T00:00:00.000Z');
	});

	it('includes the description when there is one', () => {
		expect(buildDocument(input({}, { description: 'About.' })).description).toBe('About.');
	});

	it('leaves out empty tags', () => {
		expect(buildDocument(input({}, { tags: [] }))).not.toHaveProperty('tags');
	});

	it('declares LaTeX when there is math', () => {
		const record = buildDocument(input({ hasMath: true }));
		expect(record.content).toEqual({
			$type: 'at.markpub.markdown',
			flavor: 'gfm',
			extensions: ['LaTeX'],
			text: { $type: 'at.markpub.text', markdown: '# Hi' },
		});
	});

	it('lists uploaded images and the cover', () => {
		const images = [{ image: blob('one'), alt: 'One' }, { image: blob('two', 'image/jpeg') }];
		const record = buildDocument(input({ images, coverImage: blob('cover') }));
		expect(record.imageBlobs).toEqual(images);
		expect(record.coverImage).toEqual(blob('cover'));
	});

	it('leaves out imageBlobs and coverImage when there are none', () => {
		const record = buildDocument(input());
		expect(record).not.toHaveProperty('imageBlobs');
		expect(record).not.toHaveProperty('coverImage');
	});

	it('never sets updatedAt', () => {
		expect(buildDocument(input())).not.toHaveProperty('updatedAt');
	});
});

describe('mergeForUpdate', () => {
	const existing: DocumentRecord & Record<string, unknown> = {
		...buildDocument(input({}, { description: 'Old description.' })),
		publishedAt: '2026-09-28T00:00:00.000Z',
		updatedAt: '2026-10-01T00:00:00.000Z',
		bskyPostRef: { uri: 'at://did:plc:a/app.bsky.feed.post/3mxd2abcdef22', cid: 'bafyreipost' },
		labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] },
		'com.example.extra': { kept: true },
	};

	it('returns next unchanged for a first publish', () => {
		const next = buildDocument(input());
		expect(mergeForUpdate(undefined, next)).toEqual(next);
	});

	it('keeps publishedAt and sets updatedAt to now', () => {
		const merged = mergeForUpdate(existing, buildDocument(input()));
		expect(merged.publishedAt).toBe('2026-09-28T00:00:00.000Z');
		expect(merged.updatedAt).toBe(NOW);
	});

	it('takes the content from next', () => {
		const merged = mergeForUpdate(existing, buildDocument(input({ markdown: '# New', plainText: 'New' })));
		expect(merged.textContent).toBe('New');
		expect(merged.content).toEqual(buildDocument(input({ markdown: '# New' })).content);
	});

	it('keeps fields the plugin does not own', () => {
		const merged = mergeForUpdate(existing, buildDocument(input())) as DocumentRecord & Record<string, unknown>;
		expect(merged.bskyPostRef).toEqual(existing.bskyPostRef);
		expect(merged.labels).toEqual(existing.labels);
		expect(merged['com.example.extra']).toEqual({ kept: true });
	});

	it('removes owned fields that next no longer has', () => {
		const withImages = { ...existing, imageBlobs: [{ image: blob('old') }] };
		const merged = mergeForUpdate(withImages, buildDocument(input()));
		expect(merged).not.toHaveProperty('description');
		expect(merged).not.toHaveProperty('imageBlobs');
	});

	it('does not modify its arguments', () => {
		const next = buildDocument(input());
		const before = structuredClone({ existing, next });
		mergeForUpdate(existing, next);
		expect({ existing, next }).toEqual(before);
	});
});

describe('checkPath', () => {
	const records = [
		{ uri: 'at://did:plc:a/site.standard.document/1', value: { path: '/articles/one' } },
		{ uri: 'at://did:plc:a/site.standard.document/2', value: { path: '/articles/two' } },
		{ uri: 'at://did:plc:a/site.standard.document/3', value: {} },
	];

	it('is ok when the path is this note’s own record', () => {
		expect(checkPath(records, '/articles/one', 'at://did:plc:a/site.standard.document/1')).toEqual({ kind: 'ok' });
	});

	it('is ok when no record has the path', () => {
		expect(checkPath(records, '/articles/new', undefined)).toEqual({ kind: 'ok' });
		expect(checkPath(records, '/articles/new', 'at://did:plc:a/site.standard.document/9')).toEqual({ kind: 'ok' });
	});

	it('offers to re-link a note without a record', () => {
		expect(checkPath(records, '/articles/two', undefined)).toEqual({
			kind: 'relink',
			uri: 'at://did:plc:a/site.standard.document/2',
		});
	});

	it('reports a conflict with another note’s record', () => {
		expect(checkPath(records, '/articles/two', 'at://did:plc:a/site.standard.document/1')).toEqual({
			kind: 'conflict',
			uri: 'at://did:plc:a/site.standard.document/2',
		});
	});

	it('is ok with no records at all', () => {
		expect(checkPath([], '/articles/one', undefined)).toEqual({ kind: 'ok' });
	});
});
