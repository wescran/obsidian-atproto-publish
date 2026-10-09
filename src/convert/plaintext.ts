import { toString } from 'mdast-util-to-string';
import { SKIP, visit } from 'unist-util-visit';

import { parseMarkdown } from './markdown.ts';

const TEXT_BLOCKS = new Set(['heading', 'paragraph', 'code', 'tableCell']);

/**
 * Plain-text version of a document, for standard.site's `textContent`: what
 * search indexes and readers that can't render Markdown use. Expects Markdown
 * that has already had its embeds replaced (see `replaceEmbeds`).
 */
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
