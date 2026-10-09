import { describe, expect, it } from 'vitest';

import { type Embed, findEmbeds, replaceEmbeds } from '../src/convert/embeds.ts';

const SAMPLE = [
	'See ![[photo.png|A cat]] and ![dog](img/dog.jpg) and ![x](https://e.com/x.png).',
	'Read [[Other note]] or [[Other note|this]].',
	'`[[not a link]]`',
	'```',
	'![[nope.png]]',
	'```',
].join('\n');

describe('findEmbeds', () => {
	it('finds local images and wikilinks in document order', () => {
		expect(findEmbeds(SAMPLE)).toEqual([
			{ kind: 'image', target: 'photo.png', alt: 'A cat', raw: '![[photo.png|A cat]]' },
			{ kind: 'image', target: 'img/dog.jpg', alt: 'dog', raw: '![dog](img/dog.jpg)' },
			{ kind: 'link', target: 'Other note', text: 'Other note', raw: '[[Other note]]' },
			{ kind: 'link', target: 'Other note', text: 'this', raw: '[[Other note|this]]' },
		]);
	});

	it('treats an Obsidian size alias as a size, not alt text', () => {
		expect(findEmbeds('![[photo.png|300]] ![[photo.png|300x200]]')).toEqual([
			{ kind: 'image', target: 'photo.png', alt: '', raw: '![[photo.png|300]]' },
			{ kind: 'image', target: 'photo.png', alt: '', raw: '![[photo.png|300x200]]' },
		]);
	});

	it('decodes percent-encoded and angle-bracketed Markdown image targets', () => {
		expect(findEmbeds('![a](my%20photo.png) ![b](<other photo.jpg>)')).toEqual([
			{ kind: 'image', target: 'my photo.png', alt: 'a', raw: '![a](my%20photo.png)' },
			{ kind: 'image', target: 'other photo.jpg', alt: 'b', raw: '![b](<other photo.jpg>)' },
		]);
	});

	it('strips a heading or block subpath from the link target but keeps it in the text', () => {
		expect(findEmbeds('[[Other note#Section]]')).toEqual([
			{ kind: 'link', target: 'Other note', text: 'Other note#Section', raw: '[[Other note#Section]]' },
		]);
	});

	it('treats an embedded note (transclusion) as a link', () => {
		expect(findEmbeds('![[Other note]]')).toEqual([
			{ kind: 'link', target: 'Other note', text: 'Other note', raw: '![[Other note]]' },
		]);
	});

	it('drops a .md extension from an embedded note’s text', () => {
		expect(findEmbeds('![[Other note.md]]')).toEqual([
			{ kind: 'link', target: 'Other note.md', text: 'Other note', raw: '![[Other note.md]]' },
		]);
	});

	it('reports embeds of other file types as files', () => {
		expect(findEmbeds('![[doc.pdf]] ![[song.mp3|My song]] ![[board.canvas]]')).toEqual([
			{ kind: 'file', target: 'doc.pdf', text: 'doc.pdf', raw: '![[doc.pdf]]' },
			{ kind: 'file', target: 'song.mp3', text: 'My song', raw: '![[song.mp3|My song]]' },
			{ kind: 'file', target: 'board.canvas', text: 'board.canvas', raw: '![[board.canvas]]' },
		]);
	});

	it('handles the escaped pipe Obsidian writes inside table cells', () => {
		expect(findEmbeds('| [[Other note\\|alias]] | ![[photo.png\\|100]] |\n|---|---|')).toEqual([
			{ kind: 'link', target: 'Other note', text: 'alias', raw: '[[Other note\\|alias]]' },
			{ kind: 'image', target: 'photo.png', alt: '', raw: '![[photo.png\\|100]]' },
		]);
	});

	it('treats Markdown links to vault notes like wikilinks', () => {
		expect(findEmbeds('[read](Other%20note.md#Part) and [also](<Other note.md>)')).toEqual([
			{ kind: 'link', target: 'Other note.md', text: 'read', raw: '[read](Other%20note.md#Part)' },
			{ kind: 'link', target: 'Other note.md', text: 'also', raw: '[also](<Other note.md>)' },
		]);
	});

	it('turns obsidian:// links into unresolvable links (published as their text)', () => {
		expect(findEmbeds('[open](obsidian://open?vault=x&file=y)')).toEqual([
			{ kind: 'link', target: '', text: 'open', raw: '[open](obsidian://open?vault=x&file=y)' },
		]);
	});

	it('leaves web links, mail links and same-page anchors alone', () => {
		expect(findEmbeds('[a](https://x.y) [b](mailto:a@b.c) [c](#top)')).toEqual([]);
	});

	it('ignores embeds inside math', () => {
		expect(findEmbeds('Inline $[[x]]$ and\n\n$$\n![[y.png]]\n$$')).toEqual([]);
	});

	it('ignores remote, data and mailto image targets', () => {
		expect(findEmbeds('![a](http://e.com/a.png) ![b](data:image/png;base64,AA) ![c](mailto:x@y.z)')).toEqual([]);
	});

	it('returns nothing for plain Markdown', () => {
		expect(findEmbeds('# Hello\n\nA [normal](https://example.com) link.')).toEqual([]);
	});
});

describe('replaceEmbeds', () => {
	it('replaces only embeds outside code', () => {
		const result = replaceEmbeds(SAMPLE, (e: Embed) => `<${e.kind}>`);
		expect(result).toBe(
			[
				'See <image> and <image> and ![x](https://e.com/x.png).',
				'Read <link> or <link>.',
				'`[[not a link]]`',
				'```',
				'![[nope.png]]',
				'```',
			].join('\n'),
		);
	});

	it('returns the input unchanged when there are no embeds', () => {
		const markdown = '# Title\n\nNothing to see.';
		expect(replaceEmbeds(markdown, () => 'X')).toBe(markdown);
	});
});
