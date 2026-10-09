# TODO

## Publish as Obsidian Flavored Markdown once Markpub supports it

Markpub has an open PR adding Obsidian Flavored Markdown as a known `flavor`
for `at.markpub.markdown`:
https://github.com/AramZS/markpub.at/pull/8 (opened 2026-10-06, resolves
issue #7).

Today the plugin publishes `flavor: "gfm"`, so `src/convert/embeds.ts`
rewrites every Obsidian-only construct (`![[image]]`, `[[wikilinks]]`,
size aliases, embedded notes) into plain GFM before publishing. Once the PR
is merged:

- [ ] `npm run lex:pull && npm run lex:generate` to pick up the new
      `knownValues`.
- [ ] Decide what to publish: keep `gfm` (most compatible with readers), or
      publish the new Obsidian flavor and keep more of the source as-is.
- [ ] Revisit `findEmbeds` / `replaceEmbeds`. Images still need uploading
      and their blob URLs substituting, but wikilinks, embeds and other
      Obsidian syntax could stay as written for readers that understand the
      flavor.
- [ ] Revisit `toPlainText`, which parses GFM.
