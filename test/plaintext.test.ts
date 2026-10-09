import { describe, expect, it } from 'vitest';

import { toPlainText } from '../src/convert/plaintext.ts';

describe('toPlainText', () => {
	it('strips Markdown syntax and separates blocks with blank lines', () => {
		const markdown = '# Title\n\nSome **bold** [link](https://x.y) text.\n\n![img](a.png)\n\n- one\n- two';
		expect(toPlainText(markdown)).toBe('Title\n\nSome bold link text.\n\none\n\ntwo');
	});

	it('keeps code text', () => {
		expect(toPlainText('Run `npm test`:\n\n```sh\nnpm test\n```')).toBe('Run npm test:\n\nnpm test');
	});

	it('flattens block quotes and nested lists', () => {
		expect(toPlainText('> quoted\n\n1. a\n   - b')).toBe('quoted\n\na\n\nb');
	});

	it('puts each table cell on its own', () => {
		expect(toPlainText('| A | B |\n|---|---|\n| 1 | 2 |')).toBe('A\n\nB\n\n1\n\n2');
	});

	it('drops raw HTML', () => {
		expect(toPlainText('Hello <span>there</span>\n\n<div>block</div>')).toBe('Hello there');
	});

	it('returns an empty string for an empty document', () => {
		expect(toPlainText('')).toBe('');
	});
});
