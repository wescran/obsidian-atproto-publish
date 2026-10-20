import { visit } from 'unist-util-visit';

import { inRanges, parseMarkdown, verbatimRanges } from './markdown.ts';

/**
 * Obsidian Flavored Markdown → GFM, except for embeds (see `findEmbeds`).
 * Leaves code, math, raw HTML and callouts alone.
 */

export interface GfmOptions {
	/** Obsidian's "Strict line breaks" setting; off means every newline is a line break. */
	strictLineBreaks: boolean;
}

export interface GfmResult {
	markdown: string;
	/** Anything that won't look as it does in Obsidian. */
	warnings: string[];
	/** Whether the document contains math, so the LaTeX extension is declared. */
	hasMath: boolean;
}

export function toGfm(markdown: string, options: GfmOptions): GfmResult {
	let result = stripComments(markdown);
	result = stripBlockIds(result);
	result = stripHighlights(result);
	result = stripImageSizes(result);
	if (!options.strictLineBreaks) result = hardenLineBreaks(result);
	result = convertInlineFootnotes(result);

	const warnings: string[] = [];
	let hasHtml = false;
	let hasMath = false;
	visit(parseMarkdown(result), (node) => {
		if (node.type === 'html') hasHtml = true;
		if (node.type === 'math' || node.type === 'inlineMath') hasMath = true;
	});
	if (hasHtml) warnings.push('Raw HTML was published as written, but most standard.site readers drop it.');

	return { markdown: result, warnings, hasMath };
}

/** `%%comment%%`; an unclosed `%%` hides the rest of the note, as in Obsidian. */
function stripComments(markdown: string): string {
	const skip = verbatimRanges(markdown);
	let result = '';
	let from = 0;
	for (;;) {
		const open = indexOutside(markdown, '%%', from, skip);
		if (open === -1) return result + markdown.slice(from);
		result += markdown.slice(from, open);
		const close = markdown.indexOf('%%', open + 2);
		if (close === -1) return result;
		from = close + 2;
	}
}

/** ` ^block-id` at the end of a line, or alone on a line. */
function stripBlockIds(markdown: string): string {
	return replaceOutside(
		markdown,
		/(^|[ \t]+)\^[A-Za-z0-9-]+[ \t]*$/gm,
		(m) => m.index + (m[1]?.length ?? 0),
		() => '',
	);
}

/** `==text==`: GFM has no highlight, so keep the text. */
function stripHighlights(markdown: string): string {
	return replaceOutside(
		markdown,
		/==([^\s=](?:[^\n]*?[^\s=])?)==/g,
		(m) => m.index,
		(m) => (m[1] ?? '').replace(/^(?:🔴|🟠|🟡|🟢|🔵|🟣)/u, ''),
	);
}

/** `![alt|100](src)` / `![alt|100x145](src)`: the size isn't alt text. */
function stripImageSizes(markdown: string): string {
	return replaceOutside(
		markdown,
		/!\[([^\]\n]*?)\|\d+(?:x\d+)?\]\(/g,
		(m) => m.index,
		(m) => `![${m[1] ?? ''}](`,
	);
}

/** Makes each newline in a paragraph a hard break, as Obsidian displays it. */
function hardenLineBreaks(markdown: string): string {
	const tree = parseMarkdown(markdown);
	const skip = verbatimRanges(markdown, tree);
	const inserts: number[] = [];

	visit(tree, 'paragraph', (node, _index, parent) => {
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		if (start === undefined || end === undefined) return;

		// A callout's first line is its `[!type] Title` marker, which must stay on its own.
		let skipFirst = parent?.type === 'blockquote' && markdown.startsWith('[!', start);
		for (let i = markdown.indexOf('\n', start); i !== -1 && i < end; i = markdown.indexOf('\n', i + 1)) {
			if (skipFirst) {
				skipFirst = false;
				continue;
			}
			if (inRanges(skip, i)) continue;
			const before = markdown.slice(Math.max(start, i - 2), i);
			if (before.endsWith('\\') || before === '  ') continue;
			inserts.push(i);
		}
	});

	let result = markdown;
	for (const at of inserts.sort((a, b) => b - a)) {
		result = `${result.slice(0, at)}\\${result.slice(at)}`;
	}
	return result;
}

/** `^[inline footnote]` → `[^inline-n]`, with the definitions added at the end. */
function convertInlineFootnotes(markdown: string): string {
	const skip = verbatimRanges(markdown);
	const definitions: string[] = [];
	let result = '';
	let from = 0;

	for (;;) {
		const open = indexOutside(markdown, '^[', from, skip);
		if (open === -1) break;
		const close = matchingBracket(markdown, open + 1);
		if (close === -1) break;
		const id = `inline-${definitions.length + 1}`;
		const body = markdown
			.slice(open + 2, close)
			.trim()
			.replace(/\n/g, '\n    ');
		definitions.push(`[^${id}]: ${body}`);
		result += `${markdown.slice(from, open)}[^${id}]`;
		from = close + 1;
	}

	result += markdown.slice(from);
	if (definitions.length === 0) return result;
	return `${result.replace(/\s+$/, '')}\n\n${definitions.join('\n')}`;
}

/** Index of the `]` matching the `[` at `open`, honouring nesting and `\]` escapes. */
function matchingBracket(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const char = text[i];
		if (char === '\\') i++;
		else if (char === '[') depth++;
		else if (char === ']' && --depth === 0) return i;
	}
	return -1;
}

function indexOutside(text: string, token: string, from: number, skip: Array<[number, number]>): number {
	for (let i = text.indexOf(token, from); i !== -1; i = text.indexOf(token, i + 1)) {
		if (!inRanges(skip, i)) return i;
	}
	return -1;
}

/** `String.replace` that skips matches inside code, math or HTML. */
function replaceOutside(
	markdown: string,
	pattern: RegExp,
	at: (match: RegExpMatchArray & { index: number }) => number,
	replace: (match: RegExpMatchArray) => string,
): string {
	const skip = verbatimRanges(markdown);
	let result = '';
	let last = 0;
	for (const match of markdown.matchAll(pattern)) {
		if (inRanges(skip, at(match))) continue;
		result += markdown.slice(last, match.index) + replace(match);
		last = match.index + match[0].length;
	}
	return result + markdown.slice(last);
}
