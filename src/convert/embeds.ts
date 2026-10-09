import { visit } from 'unist-util-visit';

import { parseMarkdown } from './markdown.ts';

/**
 * Obsidian-only syntax that has to be rewritten before a note can be published:
 * local images get uploaded and replaced with their blob URL, and wikilinks become
 * normal links (or plain text).
 */
export type Embed =
	| { kind: 'image'; target: string; alt: string; raw: string }
	| { kind: 'link'; target: string; text: string; raw: string };

interface Match {
	embed: Embed;
	start: number;
	end: number;
}

// 1: ![[inner]]   2,3: ![alt](src "title")   4: [[inner]]
const PATTERN = /!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?\)|\[\[([^\]\n]+?)\]\]/g;

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i;
// Obsidian uses `![[img.png|300]]` / `|300x200` to size an image, not as alt text.
const SIZE_ALIAS = /^\d+(?:x\d+)?$/;
// Anything with a scheme (http:, data:, mailto:, …) or protocol-relative is not a vault file.
const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function findEmbeds(markdown: string): Embed[] {
	return scan(markdown).map((match) => match.embed);
}

export function replaceEmbeds(markdown: string, replace: (embed: Embed) => string): string {
	let result = '';
	let last = 0;
	for (const { embed, start, end } of scan(markdown)) {
		result += markdown.slice(last, start) + replace(embed);
		last = end;
	}
	return result + markdown.slice(last);
}

function scan(markdown: string): Match[] {
	const skip = codeRanges(markdown);
	const matches: Match[] = [];

	for (const m of markdown.matchAll(PATTERN)) {
		const start = m.index;
		if (skip.some(([from, to]) => start >= from && start < to)) continue;

		const raw = m[0];
		const embed = m[1] !== undefined ? obsidianEmbed(m[1], raw)
			: m[3] !== undefined ? markdownImage(m[2] ?? '', m[3], raw)
			: wikilink(m[4] ?? '', raw);
		if (embed) matches.push({ embed, start, end: start + raw.length });
	}
	return matches;
}

/** `![[…]]`: an image file, or an embedded note, which is published as a link. */
function obsidianEmbed(inner: string, raw: string): Embed {
	const { path, target, alias } = splitInner(inner);
	if (IMAGE_FILE.test(path)) {
		const alt = alias === undefined || SIZE_ALIAS.test(alias) ? '' : alias;
		return { kind: 'image', target: path, alt, raw };
	}
	return { kind: 'link', target, text: alias ?? path, raw };
}

/** `![alt](src)`: only local files. Remote images are already publishable. */
function markdownImage(alt: string, src: string, raw: string): Embed | undefined {
	const bare = src.startsWith('<') ? src.slice(1, -1) : src;
	if (NOT_LOCAL.test(bare)) return undefined;
	return { kind: 'image', target: safeDecode(bare), alt, raw };
}

/** `[[target#sub|alias]]` */
function wikilink(inner: string, raw: string): Embed {
	const { path, target, alias } = splitInner(inner);
	return { kind: 'link', target, text: alias ?? path, raw };
}

/** `path` keeps any `#heading` / `#^block` subpath. `target` is the note to resolve. */
function splitInner(inner: string): { path: string; target: string; alias: string | undefined } {
	const bar = inner.indexOf('|');
	const path = (bar === -1 ? inner : inner.slice(0, bar)).trim();
	const alias = bar === -1 ? undefined : inner.slice(bar + 1).trim();
	const target = path.split('#')[0]?.trim() ?? '';
	return { path, target, alias };
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** Offsets of code and raw HTML, where embed-like text must be left alone. */
function codeRanges(markdown: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	visit(parseMarkdown(markdown), (node) => {
		if (node.type !== 'code' && node.type !== 'inlineCode' && node.type !== 'html') return;
		const from = node.position?.start.offset;
		const to = node.position?.end.offset;
		if (from !== undefined && to !== undefined) ranges.push([from, to]);
	});
	return ranges;
}
