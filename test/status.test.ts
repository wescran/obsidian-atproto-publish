import { describe, expect, it } from 'vitest';

import { type DocumentMeta, parseDocumentMeta } from '../src/convert/document.ts';
import { fingerprint, noteStatus, publishStatus, statusLabel } from '../src/convert/status.ts';

const META: DocumentMeta = {
	title: 'Welcome',
	description: 'About.',
	tags: ['writing'],
	slug: 'welcome',
	date: '2026-09-28T00:00:00.000Z',
	cover: 'cover.png',
};
const BODY = '# Hello\n\nWorld.';

describe('fingerprint', () => {
	it('is a 64-character hex SHA-256', async () => {
		expect(await fingerprint(META, BODY)).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is the same for the same content', async () => {
		expect(await fingerprint(META, BODY)).toBe(await fingerprint({ ...META }, BODY));
	});

	it('does not depend on the order keys were added', async () => {
		const reordered: DocumentMeta = {
			cover: 'cover.png',
			date: '2026-09-28T00:00:00.000Z',
			slug: 'welcome',
			tags: ['writing'],
			description: 'About.',
			title: 'Welcome',
		};
		expect(await fingerprint(reordered, BODY)).toBe(await fingerprint(META, BODY));
	});

	it.each([
		['the body', META, `${BODY}!`],
		['the title', { ...META, title: 'Hello' }, BODY],
		['the description', { ...META, description: 'Other.' }, BODY],
		['the tags', { ...META, tags: ['writing', 'life'] }, BODY],
		['the slug', { ...META, slug: 'hello' }, BODY],
		['the date', { ...META, date: '2026-10-01T00:00:00.000Z' }, BODY],
		['the cover', { ...META, cover: 'other.png' }, BODY],
	])('changes when %s changes', async (_field, meta, body) => {
		expect(await fingerprint(meta, body)).not.toBe(await fingerprint(META, BODY));
	});

	it('ignores the link to the record', async () => {
		const linked = { ...META, uri: 'at://did:plc:a/site.standard.document/1', publishedHash: 'ab12' };
		expect(await fingerprint(linked, BODY)).toBe(await fingerprint(META, BODY));
	});

	it('treats a missing optional field the same as an absent one', async () => {
		const { description: _description, ...withoutDescription } = META;
		const withUndefined = { ...META, description: undefined };
		expect(await fingerprint(withUndefined, BODY)).toBe(await fingerprint(withoutDescription, BODY));
	});

	it('distinguishes a missing field from an empty body', async () => {
		const { cover: _cover, ...withoutCover } = META;
		expect(await fingerprint(withoutCover, BODY)).not.toBe(await fingerprint(META, BODY));
	});
});

describe('publishStatus', () => {
	const URI = 'at://did:plc:a/site.standard.document/1';

	it('is draft before the first publish', () => {
		expect(publishStatus(META, 'abc')).toBe('draft');
	});

	it('is published when nothing changed since', () => {
		expect(publishStatus({ ...META, uri: URI, publishedHash: 'abc' }, 'abc')).toBe('published');
	});

	it('is modified when the content changed since', () => {
		expect(publishStatus({ ...META, uri: URI, publishedHash: 'abc' }, 'def')).toBe('modified');
	});

	it('is modified when there is no hash to compare with', () => {
		expect(publishStatus({ ...META, uri: URI }, 'abc')).toBe('modified');
	});
});

describe('noteStatus', () => {
	const URI = 'at://did:plc:ogl52fc2rdooori2ayf74can/site.standard.document/3mxzi7db75ksc';
	const BODY = 'Hello.\n';

	/** The frontmatter of a note just published with this body, as `markPublished` leaves it. */
	async function published(frontmatter: Record<string, unknown>, body = BODY): Promise<Record<string, unknown>> {
		const meta = parseDocumentMeta(frontmatter, 'welcome');
		return { ...frontmatter, atproto_uri: URI, slug: meta.slug, published_hash: await fingerprint(meta, body) };
	}

	it('is draft for a note that has never been published', async () => {
		expect(await noteStatus({ title: 'Welcome' }, 'welcome', BODY)).toBe('draft');
	});

	it('is draft for a note with no frontmatter at all', async () => {
		expect(await noteStatus(undefined, 'welcome', BODY)).toBe('draft');
	});

	it('is published right after publishing', async () => {
		expect(await noteStatus(await published({ title: 'Welcome', tags: ['writing'] }), 'welcome', BODY)).toBe(
			'published',
		);
	});

	it('is published when the title comes from the file name', async () => {
		expect(await noteStatus(await published({}), 'welcome', BODY)).toBe('published');
	});

	it('stays published when only properties outside the fingerprint change', async () => {
		const frontmatter = {
			...(await published({ title: 'Welcome' })),
			updated: '2026-10-17T00:00:00.000Z',
			aliases: ['hi'],
		};
		expect(await noteStatus(frontmatter, 'welcome', BODY)).toBe('published');
	});

	it('is modified when the body was edited', async () => {
		expect(await noteStatus(await published({ title: 'Welcome' }), 'welcome', 'Hello, edited.\n')).toBe('modified');
	});

	it('is modified when a published property was edited', async () => {
		const frontmatter = { ...(await published({ title: 'Welcome' })), title: 'Welcome back' };
		expect(await noteStatus(frontmatter, 'welcome', BODY)).toBe('modified');
	});

	it('is modified when renaming the file changes a title taken from the file name', async () => {
		expect(await noteStatus(await published({}), 'welcome renamed', BODY)).toBe('modified');
	});

	it('is draft when the note cannot be published and has never been', async () => {
		expect(await noteStatus({ title: 'Welcome', draft: true }, 'welcome', BODY)).toBe('draft');
		expect(await noteStatus({ title: 'Welcome', tags: 42 }, 'welcome', BODY)).toBe('draft');
	});

	it('is modified when a published note can no longer be published as it is', async () => {
		// The published version no longer matches the note, so it is "edited", not a draft.
		const frontmatter = { ...(await published({ title: 'Welcome' })), draft: true };
		expect(await noteStatus(frontmatter, 'welcome', BODY)).toBe('modified');
	});

	it('lets errors other than PublishError through', async () => {
		const frontmatter = {
			get title(): string {
				throw new TypeError('boom');
			},
		};
		await expect(noteStatus(frontmatter, 'welcome', BODY)).rejects.toThrow(TypeError);
	});
});

describe('statusLabel', () => {
	it.each([
		['draft', 'Draft'],
		['published', 'Published'],
		['modified', 'Published · edited'],
	] as const)('shows %s as "%s"', (status, label) => {
		expect(statusLabel(status)).toBe(label);
	});
});
