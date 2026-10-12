/**
 * Reader compatibility: run a note through the same steps publishing does and
 * hand the record to standard-reader's own decoder (the one behind
 * standard-reader.app). If a change to the conversion produces something a
 * standard.site reader can't render, this fails.
 */
import { buildRenderTree } from '@standard-reader/renderer-core';
import { describe, expect, it } from 'vitest';

import { replaceEmbeds } from '../src/convert/embeds.ts';
import { toGfm } from '../src/convert/ofm.ts';
import { toPlainText } from '../src/convert/plaintext.ts';
import { buildDocument } from '../src/convert/record.ts';
import { blobUrl } from '../src/urls.ts';

const DID = 'did:plc:a';
const IMAGE_URL = blobUrl('https://pds.example', DID, 'bafkreiimage');

const NOTE = [
	'# Heading',
	'',
	'Some **bold**, ==highlighted== text with a [link](https://example.com).%%private note%%',
	'A second line^[An inline footnote.]',
	'',
	'- one',
	'- two',
	'',
	'| A | B |',
	'|---|---|',
	'| 1 | 2 |',
	'',
	'```js',
	'console.log("%%kept in code%%");',
	'```',
	'',
	'> [!note] Heads up',
	'> Callout body.',
	'',
	'Math $x^2$ inline.',
	'',
	'![[cat.png|A cat]]',
].join('\n');

function publish(note: string) {
	const { markdown: gfm, hasMath } = toGfm(note, { strictLineBreaks: false });
	const markdown = replaceEmbeds(gfm, (embed) => (embed.kind === 'image' ? `![${embed.alt}](${IMAGE_URL})` : embed.text));
	return buildDocument({
		meta: { title: 'Compat', tags: [], slug: 'compat' },
		path: '/compat',
		markdown,
		plainText: toPlainText(markdown),
		hasMath,
		publicationUri: `at://${DID}/site.standard.publication/p1`,
		images: [],
		now: '2026-10-09T00:00:00.000Z',
	});
}

describe('standard-reader compatibility', () => {
	const record = publish(NOTE);
	const tree = buildRenderTree({ content: record.content, authorDid: DID } as Parameters<typeof buildRenderTree>[0]);

	it('is recognised as Markpub', () => {
		expect(tree?.format).toBe('at.markpub.markdown');
	});

	it('renders every block type the plugin produces', () => {
		const types = new Set(tree?.children.map((node) => node.type));
		for (const type of ['heading', 'paragraph', 'bulletList', 'table', 'code', 'callout', 'image']) {
			expect(types).toContain(type);
		}
	});

	it('contains no raw HTML', () => {
		expect(tree?.children.map((node) => node.type)).not.toContain('html');
	});

	it('shows the image from its blob URL', () => {
		const image = tree?.children.find((node) => node.type === 'image');
		expect(image).toMatchObject({ src: IMAGE_URL, alt: 'A cat' });
	});

	it('keeps the callout as a callout', () => {
		const callout = tree?.children.find((node) => node.type === 'callout');
		expect(callout).toMatchObject({ kind: 'note', title: 'Heads up' });
	});

	it('turns the inline footnote into a real footnote', () => {
		expect(tree?.footnotes).toHaveLength(1);
	});

	it('never publishes the private comment', () => {
		expect(JSON.stringify(record)).not.toContain('private note');
		expect(JSON.stringify(tree)).not.toContain('private note');
	});

	it('leaves code exactly as written', () => {
		expect(JSON.stringify(tree)).toContain('%%kept in code%%');
	});

	it('shows no Obsidian syntax', () => {
		const rendered = JSON.stringify(tree);
		for (const syntax of ['==', '![[', '^[']) {
			expect(rendered).not.toContain(syntax);
		}
	});

	it('declares math', () => {
		expect(record.content).toMatchObject({ extensions: ['LaTeX'] });
	});
});
