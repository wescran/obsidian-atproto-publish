# cranlab-publish

Obsidian plugin that publishes notes from the `articles/` folder of a vault to
an atproto PDS as `site.standard.document` records with `at.markpub.markdown`
content. Built for cranlab.ca. The design and implementation guide live in the
`cranlab` repo under `docs/superpowers/`.

## Development

```bash
npm install
npm test             # vitest
npm run typecheck
```

## Lexicons

`lexicons/` holds the `at.markpub.*` lexicon JSON, pulled from the network, and
`src/lexicons/` the TypeScript generated from it. Don't edit either by hand.

```bash
npm run lex:pull       # goat lex pull --update at.markpub.
npm run lex:generate   # lex-cli generate
```
