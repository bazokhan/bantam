---
name: bantam-ci-quality-gates
description: Pre-push verification recipe for bantam. Run the same gates CI runs, in the same order, before every `git push`. Use when you want CI to pass on first try, when adding a new endpoint, or when debugging a CI-only failure.
---

The CI workflow at `.github/workflows/ci.yml` runs these lanes in order: format → lint → typecheck → test → build → openapi:check → container smoke. Skip any lane and a release is blocked (`AGENTS.md` rule 7).

## One-shot: run them all

```bash
cd D:/Gamercury/bantam
npm run verify                                          # 60s, green means safe to push
npm run docs:check                                       # docs build (verify doesn't include it)
```

`npm run verify` chains format:check, lint, typecheck, test, build, openapi:check. If it passes locally, the consumer code side is good.

## When a CI lane fails locally

| Lane failure                                                      | Fastest fix                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prettier --check` reports files                                  | `npx prettier --write <files>` then re-add and push                                                                                                                                                                          |
| `eslint` reports `unsafe-any`, `await-thenable`, `no-unused-vars` | Fix the underlying code; the error message names the symbol/line. For `unsafe-any`, the source is a `Promise<any>` or untyped object — type it. For `await-thenable`, the value isn't actually a Promise — drop the `await`. |
| `tsc --noEmit` fails with `Property X is missing`                 | The manifest test fixtures (`scripts/adapters-smoke.ts`, `scripts/generate-openapi.ts`, `test/bantam.test.ts`) construct `LoadedConfig` literals — extend those to include the new required field.                           |
| `tsc --noEmit` fails with `exactOptionalPropertyTypes`            | `manifestPath?: string` in `LoadedConfig` needs `string \| undefined` (not `string?`) when the optional and undefined mean different things.                                                                                 |
| `vitest` fails with `EPERM` on Windows rmdir                      | The previous test left a file lock. `rm -rf $TMP/bantam-test-*` and retry. Or wait — better-sqlite3 releases the lock on `db.close()` and afterEach calls it.                                                                |
| `tsc -p tsconfig.build.json` fails on a TypeBox type              | The TypeBox schema definitions live in `src/config.ts` and `src/admin/manifest-store.ts`. Run `npm run openapi:generate` to refresh the snapshot, then check that `Value.Check` matches the new types.                       |
| `openapi:check` reports drift                                     | New endpoint added → snapshot is stale. `npm run openapi:generate` to rewrite, then commit the diff.                                                                                                                         |

## Adding a new admin endpoint

After you add a route:

1. Edit `src/admin/routes.ts`.
2. Add a test in `test/bantam.test.ts` covering at least the auth gate and a happy path.
3. Run `npm run verify`.
4. If you added a new request/response shape, also update `src/types.ts` and the TypeBox schema in `src/config.ts` or `src/admin/manifest-store.ts`.
5. Run `npm run openapi:generate` to refresh `openapi/bantam.openapi.json`.
6. Update the relevant docs page (`docs/src/content/docs/admin-dashboard.md` is the usual landing spot).
7. Push.

## Common test patterns

```ts
import { buildApp } from "../src/app.js";
import type { LoadedConfig } from "../src/config.js";

function config(dataDir = temp(), games = [game()]): LoadedConfig {
  return {
    environment: "test",
    dataDir,
    allowedOrigins: [],
    games: new Map(games.map((value) => [value.id, value])),
    manifestPath: undefined,
    manifestWritable: true, // admin tests don't write manifests
  };
}

// In-process Fastify app — no listen() needed
const app = await buildApp(config(dataDir), { logger: false });
const response = await app.inject({
  method: "POST",
  url: "/admin/login",
  payload: "username=alice&password=hunter2hunter2",
  headers: { "content-type": "application/x-www-form-urlencoded" },
});
// response.headers["set-cookie"] may be string OR string[] depending on Fastify internals
const cookie = (
  Array.isArray(response.headers["set-cookie"])
    ? response.headers["set-cookie"][0]
    : response.headers["set-cookie"]
)?.split(";")[0];
```

### New admin-auth-style test template

```ts
describe("my new feature", () => {
  it("requires an authenticated session", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      // Bootstrap admin via registration.
      const reg = await app.inject({
        method: "POST",
        url: "/admin/register",
        payload: "username=alice&password=hunter2hunter2&confirm=hunter2hunter2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const cookie = extractCookie(reg);
      // Now hit the new endpoint with the cookie.
      const result = await app.inject({
        method: "GET",
        url: "/admin/whatever",
        headers: { cookie },
      });
      expect(result.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
```

`extractCookie(reg)` lives in the test file:

```ts
function extractCookie(reg: { headers: Record<string, string | string[] | undefined> }): string {
  const v = reg.headers["set-cookie"];
  return (Array.isArray(v) ? v[0] : v)?.split(";")[0] ?? "";
}
```

## Why the order matters

`format:check` first catches trivial style issues. `lint` catches unused imports, type safety holes, unsafe `any`. `typecheck` is the slowest static gate and the most informative when it fails. `test` exercises the live behavior. `build` produces the actual artifact CI ships. `openapi:check` is the contract drift check. Running them in this order means a fast yes/no on the cheap ones before you wait for the slow ones.

`npm run verify` runs them sequentially via `&&`. If any fails, the chain stops. That's by design.

## Bypassing a lane (almost never)

If a lane is broken and you have an explicit reason to skip it (e.g. a known flakiness you're tracking), do **not** commit `--no-verify`. Instead:

1. Mark the lane broken in `AGENTS.md` under release gates.
2. Open an issue or TODO.
3. Push a tiny fix PR for the lane alongside your feature PR.

`AGENTS.md` rule 7 is strict: "A skipped required lane is a blocker." No lane is optional.

## What this skill does NOT cover

- CI workflow YAML itself (run `npx -y actionlint` to lint the workflow file before commit).
- The Docker image build (use `docker build -t bazokhan/bantam:dev .` then run it locally with `docker run` for a real container smoke).
- Vercel deploy wiring.
