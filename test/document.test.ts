import { describe, expect, it } from 'vitest';

import { parseDocumentMeta, parseDocumentUri, PublishError } from '../src/convert/document.ts';

const URI = 'at://did:plc:abc123/site.standard.document/3mxd2abcdef22';

/** Calls `parseDocumentMeta` expecting a `PublishError`, and returns its message. */
function errorFrom(frontmatter: Record<string, unknown> | undefined, basename = 'note'): string {
	try {
		parseDocumentMeta(frontmatter, basename);
	} catch (error) {
		expect(error).toBeInstanceOf(PublishError);
		return (error as Error).message;
	}
	throw new Error('expected a PublishError');
}

describe('parseDocumentMeta: title', () => {
	it('reads a minimal note', () => {
		expect(parseDocumentMeta({ title: 'Welcome' }, 'welcome')).toEqual({ title: 'Welcome', tags: [], slug: 'welcome' });
	});

	it('trims the title', () => {
		expect(parseDocumentMeta({ title: '  Welcome  ' }, 'welcome').title).toBe('Welcome');
	});

	it('prefers the title property over the file name', () => {
		expect(parseDocumentMeta({ title: 'Welcome!' }, 'welcome').title).toBe('Welcome!');
	});

	it.each([
		['no frontmatter', undefined],
		['empty frontmatter', {}],
		['a blank title', { title: '   ' }],
		['a non-string title', { title: 42 }],
	])('uses the file name, as Obsidian does, when there is %s', (_case, frontmatter) => {
		expect(parseDocumentMeta(frontmatter, "3rd time's the charm").title).toBe("3rd time's the charm");
	});

	it('refuses a note with no title and a blank file name', () => {
		expect(errorFrom({}, '   ')).toMatch(/title/);
	});
});

describe('parseDocumentMeta: draft', () => {
	it('refuses a draft', () => {
		expect(errorFrom({ title: 'X', draft: true })).toMatch(/draft/);
	});

	it('allows draft: false', () => {
		expect(parseDocumentMeta({ title: 'X', draft: false }, 'x').title).toBe('X');
	});

	it.each(['true', 'TRUE', ' True '])(
		'refuses draft: %j, which Obsidian writes when the property type is Text',
		(draft) => {
			expect(errorFrom({ title: 'X', draft })).toMatch(/draft: true/);
		},
	);

	it.each(['false', 'FALSE', ' False ', '', '  ', null])('allows draft: %j', (draft) => {
		expect(parseDocumentMeta({ title: 'X', draft }, 'x').title).toBe('X');
	});

	it.each(['yes', 'no', 1, 0, ['true'], { draft: true }])(
		'refuses an unclear draft value (%j), asking for a checkbox',
		(draft) => {
			expect(errorFrom({ title: 'X', draft })).toMatch(/"draft".*checkbox/);
		},
	);
});

describe('parseDocumentMeta: description', () => {
	it('trims it', () => {
		expect(parseDocumentMeta({ title: 'X', description: ' About X. ' }, 'x').description).toBe('About X.');
	});

	it('omits an empty one', () => {
		expect(parseDocumentMeta({ title: 'X', description: '  ' }, 'x')).not.toHaveProperty('description');
	});
});

describe('parseDocumentMeta: tags', () => {
	it('strips # and whitespace', () => {
		expect(parseDocumentMeta({ title: 'X', tags: ['#writing', ' life '] }, 'x').tags).toEqual(['writing', 'life']);
	});

	it('accepts a single string', () => {
		expect(parseDocumentMeta({ title: 'X', tags: 'writing' }, 'x').tags).toEqual(['writing']);
	});

	it('drops empty, non-string and duplicate entries', () => {
		expect(parseDocumentMeta({ title: 'X', tags: ['a', '', '#', 7, null, 'a', '#a', 'b'] }, 'x').tags).toEqual([
			'a',
			'b',
		]);
	});

	it('defaults to an empty list', () => {
		expect(parseDocumentMeta({ title: 'X', tags: null }, 'x').tags).toEqual([]);
	});
});

describe('parseDocumentMeta: slug', () => {
	it('comes from the file name by default', () => {
		expect(parseDocumentMeta({ title: 'X' }, "3rd time's the charm").slug).toBe('3rd-times-the-charm');
	});

	it('prefers the frontmatter slug, slugified', () => {
		expect(parseDocumentMeta({ title: 'X', slug: 'Custom Slug' }, 'whatever').slug).toBe('custom-slug');
	});

	it('falls back to the file name when the frontmatter slug is blank', () => {
		expect(parseDocumentMeta({ title: 'X', slug: '' }, 'from-file').slug).toBe('from-file');
	});

	it('refuses a name with nothing to slugify', () => {
		expect(errorFrom({ title: 'X' }, '日本語')).toMatch(/slug/);
	});
});

describe('parseDocumentMeta: date', () => {
	it('normalises a date to ISO 8601', () => {
		expect(parseDocumentMeta({ title: 'X', date: '2026-09-28' }, 'x').date).toBe('2026-09-28T00:00:00.000Z');
	});

	it('accepts a full timestamp', () => {
		expect(parseDocumentMeta({ title: 'X', date: '2026-09-28T14:30:00Z' }, 'x').date).toBe('2026-09-28T14:30:00.000Z');
	});

	it('accepts a Date object', () => {
		expect(parseDocumentMeta({ title: 'X', date: new Date('2026-09-28T00:00:00Z') }, 'x').date).toBe(
			'2026-09-28T00:00:00.000Z',
		);
	});

	it('refuses a date it cannot read, quoting it', () => {
		const message = errorFrom({ title: 'X', date: 'last Tuesday' });
		expect(message).toMatch(/date/);
		expect(message).toContain('last Tuesday');
	});

	it.each([
		['a bare year (YAML reads it as a number)', 2026],
		['a list', ['2026-09-28']],
		['a boolean', true],
	])('refuses %s', (_case, date) => {
		expect(errorFrom({ title: 'X', date })).toMatch(/date/);
	});

	it('treats an empty date property as no date', () => {
		expect(parseDocumentMeta({ title: 'X', date: null }, 'x')).not.toHaveProperty('date');
	});
});

describe('parseDocumentMeta: cover', () => {
	it('strips Obsidian link brackets', () => {
		expect(parseDocumentMeta({ title: 'X', cover: '[[cover.png]]' }, 'x').cover).toBe('cover.png');
		expect(parseDocumentMeta({ title: 'X', cover: '![[cover.png]]' }, 'x').cover).toBe('cover.png');
	});

	it('drops the display text of an aliased link', () => {
		expect(parseDocumentMeta({ title: 'X', cover: '[[cover.png|My cover]]' }, 'x').cover).toBe('cover.png');
		expect(parseDocumentMeta({ title: 'X', cover: '![[cover.png|200]]' }, 'x').cover).toBe('cover.png');
	});

	it('keeps a plain path', () => {
		expect(parseDocumentMeta({ title: 'X', cover: 'images/cover.png' }, 'x').cover).toBe('images/cover.png');
	});
});

describe('parseDocumentMeta: error messages', () => {
	it.each([
		['no title at all', {}, '   '],
		['a draft', { title: 'X', draft: true }, 'note'],
		['an empty slug', { title: 'X' }, '日本語'],
		['an unreadable date', { title: 'X', date: 'soon' }, 'note'],
		['a bad atproto_uri', { title: 'X', atproto_uri: 'https://e.com' }, 'note'],
	])('says how to fix %s, in plain text', (_case, frontmatter, basename) => {
		const message = errorFrom(frontmatter, basename);
		expect(message).not.toMatch(/undefined|\$\{|`/);
		expect(message.length).toBeGreaterThan(30);
	});

	it('quotes a frontmatter slug that has nothing usable', () => {
		expect(errorFrom({ title: 'X', slug: '!!!' }, 'note')).toContain('!!!');
	});
});

describe('parseDocumentMeta: link to the record', () => {
	it('reads atproto_uri and published_hash', () => {
		const meta = parseDocumentMeta({ title: 'X', atproto_uri: URI, published_hash: 'ab12' }, 'x');
		expect(meta.uri).toBe(URI);
		expect(meta.publishedHash).toBe('ab12');
	});

	it.each([
		'https://example.com/doc',
		'at://did:plc:abc123/app.bsky.feed.post/3mxd2abcdef22',
		'at://did:plc:abc123/site.standard.document/',
		'not a uri\nat://did:plc:abc123/site.standard.document/3mxd2abcdef22',
	])('refuses an atproto_uri that is not a document: %s', (uri) => {
		expect(errorFrom({ title: 'X', atproto_uri: uri })).toMatch(/atproto_uri/);
	});

	it('leaves out keys that are not set', () => {
		expect(Object.keys(parseDocumentMeta({ title: 'X' }, 'x')).sort()).toEqual(['slug', 'tags', 'title']);
	});
});

describe('parseDocumentUri', () => {
	it('returns a valid document URI', () => {
		expect(parseDocumentUri(URI)).toBe(URI);
	});

	it('trims it', () => {
		expect(parseDocumentUri(`  ${URI} `)).toBe(URI);
	});

	it.each([undefined, null, '', '   ', 42])('treats %j as no URI', (value) => {
		expect(parseDocumentUri(value)).toBeUndefined();
	});

	it('refuses a URI that is not a document, mentioning atproto_uri', () => {
		expect(() => parseDocumentUri('https://example.com/doc')).toThrow(PublishError);
		expect(() => parseDocumentUri('https://example.com/doc')).toThrow(/atproto_uri/);
	});

	it('does not care about the rest of the note: drafts and untitled notes still have a URI', () => {
		const frontmatter = { draft: true, atproto_uri: URI };
		expect(() => parseDocumentMeta(frontmatter, 'x')).toThrow(PublishError);
		expect(parseDocumentUri(frontmatter.atproto_uri)).toBe(URI);
	});
});
