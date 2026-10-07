# Bantam documentation

Astro Starlight site for Bantam Game Services. Lives in `D:/Gamercury/bantam/docs/`.

## Build

```bash
cd docs
npm install
npm run build
```

`reference:sync` copies `../openapi/bantam.openapi.json` and `../packages/sdk/src/index.ts` into `public/reference/` so the docs site is self-contained for any deployment.

The site is not shipped from the runtime container. Build it separately; serve from any static host.
