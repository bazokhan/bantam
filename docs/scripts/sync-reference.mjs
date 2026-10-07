// Copies the OpenAPI snapshot and SDK source from the same-repo source-of-truth
// paths into docs/public/reference/. Run as part of `npm run docs:build` and
// `npm run docs:check`. Operates within a single repo (no parent traversal).

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serviceRoot = resolve(docsRoot, "..");
const references = [
  {
    source: resolve(serviceRoot, "openapi", "bantam.openapi.json"),
    target: resolve(docsRoot, "public", "reference", "bantam.openapi.json"),
  },
  {
    source: resolve(serviceRoot, "packages", "sdk", "src", "index.ts"),
    target: resolve(docsRoot, "public", "reference", "bantam-sdk.ts"),
  },
];

for (const reference of references) {
  if (process.argv.includes("--check")) {
    if (!readFileSync(reference.source).equals(readFileSync(reference.target))) {
      throw new Error(`Reference snapshot is stale: ${reference.target}`);
    }
  } else {
    mkdirSync(dirname(reference.target), { recursive: true });
    copyFileSync(reference.source, reference.target);
    process.stdout.write(`${reference.target}\n`);
  }
}
