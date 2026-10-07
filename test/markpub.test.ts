import { is } from '@atcute/lexicons';
import { describe, expect, it } from 'vitest';

import { AtMarkpubMarkdown } from '../src/lexicons/index.ts';

describe('at.markpub.markdown schema', () => {
	it('accepts GFM markdown content', () => {
		const content = {
			$type: 'at.markpub.markdown',
			flavor: 'gfm',
			text: { $type: 'at.markpub.text', markdown: '# Hi' },
		};
		expect(is(AtMarkpubMarkdown.mainSchema, content)).toBe(true);
	});

	it('rejects content without text', () => {
		const content = { $type: 'at.markpub.markdown', flavor: 'gfm' };
		expect(is(AtMarkpubMarkdown.mainSchema, content)).toBe(false);
	});
});
