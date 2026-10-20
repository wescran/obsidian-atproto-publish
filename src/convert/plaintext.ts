import { toString } from 'mdast-util-to-string';
import { SKIP, visit } from 'unist-util-visit';

import { parseMarkdown } from './markdown.ts';

const TEXT_BLOCKS = new Set(['heading', 'paragraph', 'code', 'tableCell']);

/** Plain text for `textContent`, from Markdown with embeds already replaced. */
export function toPlainText(markdown: string): string {
	const chunks: string[] = [];
	visit(parseMarkdown(markdown), (node) => {
		if (!TEXT_BLOCKS.has(node.type)) return;
		const text = toString(node, { includeImageAlt: false, includeHtml: false }).trim();
		if (text) chunks.push(text);
		return SKIP;
	});
	return chunks.join('\n\n');
}
