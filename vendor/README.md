# vendor

`anthropic-sdk.mjs` is the official Anthropic TypeScript SDK (`@anthropic-ai/sdk` 1.8.0, Apache-2.0, license in `anthropic-sdk.LICENSE`) bundled into one file, so the plugin works without `npm install`. Only the API backend loads it.

Rebuild:

```bash
npm i --no-save @anthropic-ai/sdk@<version> esbuild
npx esbuild node_modules/@anthropic-ai/sdk/index.mjs --bundle --platform=node --format=esm --target=node18 --minify --legal-comments=eof --outfile=vendor/anthropic-sdk.mjs
```
