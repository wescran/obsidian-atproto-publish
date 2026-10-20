import type { Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import { visit } from 'unist-util-visit';

/** GFM plus math, parsed the way standard.site readers do. */
export function parseMarkdown(markdown: string): Root {
	return fromMarkdown(markdown, {
		extensions: [gfm(), math()],
		mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
	});
}

const VERBATIM = new Set(['code', 'inlineCode', 'math', 'inlineMath', 'html']);

/** Offset ranges of code, math and raw HTML, where text is shown as written. */
export function verbatimRanges(markdown: string, tree: Root = parseMarkdown(markdown)): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	visit(tree, (node) => {
		if (!VERBATIM.has(node.type)) return;
		const from = node.position?.start.offset;
		const to = node.position?.end.offset;
		if (from !== undefined && to !== undefined) ranges.push([from, to]);
	});
	return ranges;
}

export function inRanges(ranges: Array<[number, number]>, offset: number): boolean {
	return ranges.some(([from, to]) => offset >= from && offset < to);
}
