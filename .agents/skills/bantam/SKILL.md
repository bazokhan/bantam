---
name: bantam
description: Wires a game to Bantam authoritative leaderboards — auth, evidence-only run submit, GameAdapterV1, games.json, BantamClient, PGS v2 vs development auth. Use when adding leaderboards, adapters, BantamClient, games.json, or Play Games v2 to a Bantam-backed game.
---

# Bantam

Game-agnostic leaderboard backend. Clients submit **evidence**. A versioned server adapter **derives** board values inside the run transaction. No game-specific code ships in this repository.

Read [reference.md](reference.md) for OpenAPI paths, manifest schema, `GameAdapterV1`, and SDK methods. Prefer live `GET {base}/openapi.json` over a remembered schema.

## Hosts

| Role                    | URL                            |
| ----------------------- | ------------------------------ |
| Docs                    | https://bantam.trugraph.io     |
| Live API (this project) | https://bantam-api.trugraph.io |
| Local default           | http://localhost:3000          |

Probe, in order: `GET /healthz`, `GET /version`, `GET /openapi.json`. `/version.adapters` is the loaded adapter id list. An empty list means no games in the manifest yet.

## What Bantam is / is not

**Is:** player auth and sessions; adapter-validated run submit; leaderboards (page, me, around-me); `DELETE` player; admin manifest hot-reload; Litestream backup.

**Is not:** ads, IAP, analytics funnels, Crashlytics, remote feature flags, or a first-class achievements API. Do not dump an analytics queue into a run payload.

## Secrets (non-negotiable)

The skill ships **zero** passwords, tokens, salts, PGS secrets, or session cookies.

- May name **paths and env var names only**.
- Operator admin file (gitignored): `deploy/credentials.local/admin.env`. If it exists, **read it; never echo values** into chat, commits, issues, plans, or examples.
- Per-game env (all values min length 16): `${secretPrefix}_IDENTITY_SALT`, `${secretPrefix}_SESSION_SECRET`, `${secretPrefix}_CURSOR_SECRET`. For `pgs-v2` also `${secretPrefix}_PGS_CLIENT_ID` and `${secretPrefix}_PGS_CLIENT_SECRET`.
- CORS: `BANTAM_ALLOWED_ORIGINS` (comma-separated).
- Never log bodies, credentials, tokens, raw provider IDs, IP addresses, or unredacted headers (`AGENTS.md`).
- Public local example `authorizationCode: "demo-player"` in the README is development-only, not a live admin credential.
- Production manifests **reject** `authProvider: "development"`.

## Wire a game (checklist)

1. Choose `game.id` matching `^[a-z0-9][a-z0-9-]{1,47}$`.
2. Set `secretPrefix` (`^[A-Z][A-Z0-9_]{1,47}$`) and provision the env vars above on the host. Do not commit them.
3. `authProvider`: `development` for local/Internal experiments; `pgs-v2` for Play Games server auth codes. Spec both; flip the manifest when Play OAuth exists. Live/production must not use development auth.
4. Prefer `kind: "file"` adapters in a **sibling game repo**, compiled to `.js`/`.mjs`, mounted at `/bantam/adapters`. `source` is the **basename**. Restart the container to load new files (not hot-reloaded). Generic boards (`kind: "generic"`, max 16) accept claimed integers only — stub/demo, not competitive games.
5. Put the game on the live manifest via `/admin` (writable `/data/games.json`) or a mounted `games.json` (read-only editor). First admin: `/admin/register` once, then `/admin/login`.
6. Client: `npm install @gamercury/bantam-sdk` from the **public npm registry** (not `file:../bantam`). `BantamClient` with `baseUrl`, `gameId`, `KeyValueStorage`. `optionalLogin` → `queueBest` after a valid run → `leaderboard` / `myRank` / `aroundMe`. `deleteMyData` for erasure. Offline queue is local; 4xx except 401/429 drops the run; 401 refreshes then retries. Maintainers publish with GitHub Actions trusted publishing (workflow `publish-sdk.yml`, GitHub user + repo, no org, no `NPM_TOKEN`). Docs: `docs/src/content/docs/sdk.md`. Never publish `@gamercury/bantam` (server).
7. Gameplay stays playable with login cancelled or the API down.

## Adapter contract (short)

Default export (or named `adapter`) implements `GameAdapterV1`: `id`, `version`, `boards`, `validateAndDerive(payload, context) → { normalized, values }`. Unknown payload fields must throw. Derived `values[]` are `{ boardId, periodKey, value }` with `periodKey` `"all_time"` or `YYYY-MM-DD` UTC for `daily`. `.ts` is not loaded at runtime.

## Verify (Bantam repo)

`npm run verify` is the gate. Do not skip format, lint, typecheck, tests, build, or OpenAPI drift. Adapter/container/backup lanes listed in the README remain blockers when you change those surfaces.

Do not create remotes, deploy Docker images, or publish npm packages without explicit owner approval. Approved SDK publishes use git tag `sdk-v*` (trusted publishing on `publish-sdk.yml`) or local `npm run sdk:publish` with 2FA. No `NPM_TOKEN`.
