import { describe, expect, it } from 'vitest';

import { toGfm } from '../src/convert/ofm.ts';

const strict = { strictLineBreaks: true };
const gfm = (markdown: string) => toGfm(markdown, strict).markdown;

describe('toGfm: comments', () => {
	it('removes inline comments', () => {
		expect(gfm('Hello %%secret%% world')).toBe('Hello  world');
	});

	it('removes multi-line comment blocks', () => {
		expect(gfm('A\n\n%%\nprivate\nnotes\n%%\n\nB')).toBe('A\n\n\n\nB');
	});

	it('hides everything after an unclosed comment, as Obsidian does', () => {
		expect(gfm('Visible\n\n%% never closed\nhidden')).toBe('Visible\n\n');
	});

	it('leaves %% inside code alone', () => {
		const markdown = 'Use `%%x%%` here.\n\n```\n%% not a comment %%\n```';
		expect(gfm(markdown)).toBe(markdown);
	});
});

describe('toGfm: block IDs', () => {
	it('removes a block ID at the end of a line', () => {
		expect(gfm('A paragraph ^abc-123')).toBe('A paragraph');
	});

	it('removes a block ID on its own line', () => {
		expect(gfm('- item\n\n^list-id')).toBe('- item\n\n');
	});

	it('leaves footnotes and inline code alone', () => {
		const markdown = 'Text[^1] and `x ^y`\n\n[^1]: Note.';
		expect(gfm(markdown)).toBe(markdown);
	});
});

describe('toGfm: highlights', () => {
	it('keeps the text and drops the markers and colour emoji', () => {
		expect(gfm('==yes== and ==🔴red==')).toBe('yes and red');
	});

	it('leaves setext headings and code alone', () => {
		const markdown = 'Title\n===\n\n`==code==`';
		expect(gfm(markdown)).toBe(markdown);
	});
});

describe('toGfm: inline footnotes', () => {
	it('turns them into numbered GFM footnotes', () => {
		expect(gfm('Text^[note one] and ^[two [link](https://x.y)].')).toBe(
			'Text[^inline-1] and [^inline-2].\n\n[^inline-1]: note one\n[^inline-2]: two [link](https://x.y)',
		);
	});

	it('leaves an unclosed one as written', () => {
		expect(gfm('Oops ^[never closed')).toBe('Oops ^[never closed');
	});
});

describe('toGfm: image sizes', () => {
	it('removes |width and |widthxheight from Markdown image alt text', () => {
		expect(gfm('![Engelbart|100x145](https://e.com/a.jpg) ![|100](b.png)')).toBe(
			'![Engelbart](https://e.com/a.jpg) ![](b.png)',
		);
	});
});

describe('toGfm: line breaks', () => {
	const loose = (markdown: string) => toGfm(markdown, { strictLineBreaks: false }).markdown;

	it('makes single newlines hard breaks when strict line breaks are off', () => {
		expect(loose('one\ntwo\n\nthree')).toBe('one\\\ntwo\n\nthree');
	});

	it('leaves them alone when strict line breaks are on', () => {
		expect(gfm('one\ntwo')).toBe('one\ntwo');
	});

	it('leaves existing hard breaks alone', () => {
		expect(loose('a  \nb\\\nc')).toBe('a  \nb\\\nc');
	});

	it('works in list items and quotes', () => {
		expect(loose('- a\n  b\n\n> c\n> d')).toBe('- a\\\n  b\n\n> c\\\n> d');
	});

	it('keeps a callout’s marker line intact', () => {
		expect(loose('> [!note] Title\n> body\n> more')).toBe('> [!note] Title\n> body\\\n> more');
	});

	it('leaves code alone', () => {
		const markdown = '```\na\nb\n```';
		expect(loose(markdown)).toBe(markdown);
	});
});

describe('toGfm: reporting', () => {
	it('warns about raw HTML', () => {
		const { warnings } = toGfm('Hi <span>x</span>\n\n<div>y</div>', strict);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('HTML');
	});

	it('reports math', () => {
		expect(toGfm('$$\nx^2\n$$', strict).hasMath).toBe(true);
		expect(toGfm('Inline $a$.', strict).hasMath).toBe(true);
		expect(toGfm('No math.', strict).hasMath).toBe(false);
	});

	it('returns plain GFM unchanged, with no warnings', () => {
		const markdown = '# Title\n\nSome **bold**, ~~strike~~, a [link](https://x.y).\n\n- [ ] task\n\n> [!tip] Callout\n> body';
		expect(toGfm(markdown, strict)).toEqual({ markdown, warnings: [], hasMath: false });
	});
});
