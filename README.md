# ATproto Publish

An Obsidian plugin that **deliberately publishes** notes to your atproto PDS
as [standard.site](https://standard.site) documents, with
[`at.markpub.markdown`](https://markpub.at) content. Nothing is synced
automatically: a note goes public only when you run **Publish article**, and
republishing updates the same record.

Each published note keeps a link to its record in its frontmatter
(`atproto_uri`), so edits, renames and other devices all point at the same
document.

## Development

```bash
npm install
npm test             # vitest
npm run typecheck
npm run format       # prettier; `npm run format:check` to verify
npm run build        # or `npm run dev` to rebuild on every change
```

## Installing into a vault (development)

```bash
P="<vault>/.obsidian/plugins/atproto-publish"
mkdir -p "$P"
ln -sfn "$PWD/main.js" "$P/main.js"
ln -sfn "$PWD/manifest.json" "$P/manifest.json"
```

Then enable **ATproto Publish** under Settings → Community plugins. Its
settings (`data.json`) stay in the vault's plugin folder, not in this repo.

## Lexicons

`lexicons/` holds the `at.markpub.*` lexicon JSON, pulled from the network, and
`src/lexicons/` the TypeScript generated from it. Don't edit either by hand.

```bash
npm run lex:pull       # goat lex pull --update at.markpub.
npm run lex:generate   # lex-cli generate
```
