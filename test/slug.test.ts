import { describe, expect, it } from 'vitest';

import { slugify } from '../src/convert/slug.ts';

describe('slugify', () => {
	it('lowercases', () => {
		expect(slugify('Welcome')).toBe('welcome');
	});

	it('removes punctuation and hyphenates words', () => {
		expect(slugify("3rd time's the charm?")).toBe('3rd-times-the-charm');
	});

	it('removes accents', () => {
		expect(slugify('Café au lait')).toBe('cafe-au-lait');
	});

	it('collapses whitespace and repeated separators', () => {
		expect(slugify('  Hello   World -- again ')).toBe('hello-world-again');
	});

	it('keeps existing hyphens as word separators', () => {
		expect(slugify('obsidian-atproto-publish')).toBe('obsidian-atproto-publish');
	});

	it('turns underscores, slashes and dots into separators', () => {
		expect(slugify('foo_bar/baz.qux')).toBe('foo-bar-baz-qux');
	});

	it('drops curly apostrophes like straight ones', () => {
		expect(slugify('It’s here')).toBe('its-here');
	});

	it('trims separators from both ends', () => {
		expect(slugify('?Hello!')).toBe('hello');
		expect(slugify('¿Qué? ¡Sí!')).toBe('que-si');
	});

	it('returns an empty string when nothing is left', () => {
		expect(slugify('日本語')).toBe('');
		expect(slugify('!!!')).toBe('');
	});
});
