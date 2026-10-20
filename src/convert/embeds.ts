import { inRanges, verbatimRanges } from './markdown.ts';

/** Finds and replaces references to vault files: images, note links and other embeds. */
export type Embed =
	| { kind: 'image'; target: string; alt: string; raw: string }
	| { kind: 'link'; target: string; text: string; raw: string }
	| { kind: 'file'; target: string; text: string; raw: string };

interface Match {
	embed: Embed;
	start: number;
	end: number;
}

const DESTINATION = String.raw`(<[^>\n]+>|[^)\s]+)(?:\s+"[^"\n]*")?`;
const PATTERN = new RegExp(
	[
		String.raw`!\[\[([^\]\n]+?)\]\]`, // 1: ![[inner]]
		String.raw`!\[([^\]\n]*)\]\(${DESTINATION}\)`, // 2, 3: ![alt](src)
		String.raw`\[\[([^\]\n]+?)\]\]`, // 4: [[inner]]
		String.raw`\[([^\]\n]*)\]\(${DESTINATION}\)`, // 5, 6: [text](href)
	].join('|'),
	'g',
);

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp)$/i;
// A note is linked without an extension, or with `.md`.
const NOTE_FILE = /(?:^|\/)[^/.]+$|\.md$/i;
// Obsidian uses `|300` / `|300x200` to size an image, not as alt text.
const SIZE_ALIAS = /^\d+(?:x\d+)?$/;
// Anything with a scheme, or protocol-relative, isn't a vault file.
const HAS_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const OBSIDIAN_URI = /^obsidian:/i;

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
	const skip = verbatimRanges(markdown);
	const matches: Match[] = [];

	for (const m of markdown.matchAll(PATTERN)) {
		const start = m.index;
		if (inRanges(skip, start)) continue;

		const raw = m[0];
		let embed: Embed | undefined;
		if (m[1] !== undefined) embed = obsidianEmbed(m[1], raw);
		else if (m[3] !== undefined) embed = markdownImage(m[2] ?? '', m[3], raw);
		else if (m[4] !== undefined) embed = wikilink(m[4], raw);
		else if (m[6] !== undefined) embed = markdownLink(m[5] ?? '', m[6], raw);

		if (embed) matches.push({ embed, start, end: start + raw.length });
	}
	return matches;
}

/** `![[…]]`: an image, an embedded note (published as a link), or another file. */
function obsidianEmbed(inner: string, raw: string): Embed {
	const { path, target, alias } = splitInner(inner);
	if (IMAGE_FILE.test(path)) {
		const alt = alias === undefined || SIZE_ALIAS.test(alias) ? '' : alias;
		return { kind: 'image', target: path, alt, raw };
	}
	if (NOTE_FILE.test(target)) {
		return { kind: 'link', target, text: alias ?? stripMd(path), raw };
	}
	return { kind: 'file', target, text: alias ?? path, raw };
}

/** `![alt](src)`: only local files. Remote images are already publishable. */
function markdownImage(alt: string, src: string, raw: string): Embed | undefined {
	const href = unwrap(src);
	if (HAS_SCHEME.test(href)) return undefined;
	return { kind: 'image', target: safeDecode(href), alt, raw };
}

/** `[[target#sub|alias]]` */
function wikilink(inner: string, raw: string): Embed {
	const { path, target, alias } = splitInner(inner);
	return { kind: 'link', target, text: alias ?? path, raw };
}

/** `[text](href)` to a vault note or `obsidian://`. Web links and anchors are left alone. */
function markdownLink(text: string, href: string, raw: string): Embed | undefined {
	const bare = unwrap(href);
	if (OBSIDIAN_URI.test(bare)) return { kind: 'link', target: '', text, raw };
	if (HAS_SCHEME.test(bare) || bare.startsWith('#')) return undefined;
	const target = safeDecode(bare).split('#')[0]?.trim() ?? '';
	return { kind: 'link', target, text, raw };
}

/** Splits `target#sub|alias`; inside a table the pipe is escaped as `\|`. */
function splitInner(inner: string): { path: string; target: string; alias: string | undefined } {
	const bar = /\\?\|/.exec(inner);
	const path = (bar ? inner.slice(0, bar.index) : inner).trim();
	const alias = bar ? inner.slice(bar.index + bar[0].length).trim() : undefined;
	const target = path.split('#')[0]?.trim() ?? '';
	return { path, target, alias };
}

function unwrap(destination: string): string {
	return destination.startsWith('<') ? destination.slice(1, -1) : destination;
}

function stripMd(path: string): string {
	return path.replace(/\.md$/i, '');
}

function safeDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
