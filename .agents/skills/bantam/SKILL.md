---
name: bantam
description: Wires a game to Bantam — auth, evidence-only run submit, leaderboards, feature flags, optional economy (wallet, shop, Google Play IAP), GameAdapterV1, games.json, BantamClient, PGS v2 vs development auth. Use when adding leaderboards, flags, economy, adapters, BantamClient, games.json, or Play Games v2 to a Bantam-backed game.
---

# Bantam

Game-agnostic backend for leaderboards, feature flags, and an optional server-owned economy. Clients submit **evidence**. A versioned server adapter **derives** board values inside the run transaction. Catalog prices and IAP grants are server-derived. No game-specific code ships in this repository.

Read [reference.md](reference.md) for OpenAPI paths, manifest schema, `GameAdapterV1`, and SDK methods. Prefer live `GET {base}/openapi.json` over a remembered schema.

## Hosts

| Role                    | URL                            |
| ----------------------- | ------------------------------ |
| Docs                    | https://bantam.trugraph.io     |
| Live API (this project) | https://bantam-api.trugraph.io |
| Local default           | http://localhost:3000          |

Probe, in order: `GET /healthz`, `GET /version`, `GET /openapi.json`. `/version.adapters` is the loaded adapter id list. An empty list means no games in the manifest yet.

## What Bantam is / is not

**Is:** player auth and sessions; adapter-validated run submit; leaderboards (page, me, around-me); per-game feature flags (`GET /v1/games/{gameId}/flags`, operator-written in the admin UI); optional server-authoritative economy (wallets, inventory, virtual shop, Google Play IAP verification); `DELETE` player; admin manifest hot-reload; Litestream backup.

**Is not:** ads, analytics funnels, Crashlytics, a first-class achievements API, or a catalog CMS. Do not dump an analytics queue into a run payload. Clients never set balances or prices.

### Feature flags

Per-game, server-resolved, read-only to clients. Operators set them in the console at `/admin/console/games/{id}/flags` (JSON API: `/admin/api/games/{id}/flags`); the server-rendered page stays at `/admin/games/{id}/flags`. Clients read `GET /v1/games/{gameId}/flags` or call `bantam.getFlags()` / `bantam.isEnabled(key)`.

- `enabled` is the rollout decision for that caller: master switch off ⇒ `false`; `100%` ⇒ `true` for everyone including signed-out; `1-99%` ⇒ resolved per signed-in player, always `false` when anonymous (no stable id to bucket).
- Bucketing is `HMAC-SHA256(flagKey + ":" + playerId, ${secretPrefix}_IDENTITY_SALT)` — stable across restarts and instances, and not correlatable across games.
- Never put a secret in a flag `value`; it is sent only when the flag resolves on for that caller. `description` is operator-facing and never sent.
- Gameplay must stay playable when the flag read fails or login is cancelled. `isEnabled(key, fallback)` uses `fallback` when the flag is missing or the read fails. Treat a missing flag as `false` and keep a local default.

## Secrets (non-negotiable)

The skill ships **zero** passwords, tokens, salts, PGS secrets, or session cookies.

- May name **env var names only**. Never name a credential file path.
- If operator credentials exist outside git, read them for local wiring and never echo values into chat, commits, issues, plans, or examples.
- Per-game env (all values min length 16): `${secretPrefix}_IDENTITY_SALT`, `${secretPrefix}_SESSION_SECRET`, `${secretPrefix}_CURSOR_SECRET`. For `pgs-v2` also `${secretPrefix}_PGS_CLIENT_ID` and `${secretPrefix}_PGS_CLIENT_SECRET`. For Google Play IAP products, `${secretPrefix}_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (service-account JSON; name only).
- CORS: `BANTAM_ALLOWED_ORIGINS` (comma-separated).
- Never log bodies, credentials, tokens, raw provider IDs, IP addresses, or unredacted headers (`AGENTS.md`).
- Public local example `authorizationCode: "demo-player"` in the README is development-only, not a live admin credential.
- Production manifests **reject** `authProvider: "development"`.

## Wire a game (checklist)

1. Choose `game.id` matching `^[a-z0-9][a-z0-9-]{1,47}$`.
2. Set `secretPrefix` (`^[A-Z][A-Z0-9_]{1,47}$`) and provision the env vars above on the host. Do not commit them.
3. `authProvider`: `development` for local/Internal experiments; `pgs-v2` for Play Games server auth codes. Spec both; flip the manifest when Play OAuth exists. Live/production must not use development auth.
4. Prefer `kind: "file"` adapters in a **sibling game repo**, compiled to `.js`/`.mjs`, mounted at `/bantam/adapters`. `source` is the **basename**. Restart the container to load new files (not hot-reloaded). Generic boards (`kind: "generic"`, max 16) accept claimed integers only — stub/demo, not competitive games.
5. Put the game on the live manifest via `/admin` (writable `/data/games.json`) or a mounted `games.json` (read-only editor). First admin: `/admin/register` once, then `/admin/login`. The console at `/admin/console/` shows file-adapter boards, players and runs; the server-rendered pages remain at `/admin/legacy`. Do not treat an empty game page as a missing game. Plan: `ADMIN_DASHBOARD_PLAN.md`, gap analysis: `ADMIN_CONSOLE_GAP_ANALYSIS.md`.
6. Client: `npm install @gamercury/bantam-sdk` from the **public npm registry** (not `file:../bantam`). `BantamClient` with `baseUrl`, `gameId`, `KeyValueStorage`. `optionalLogin` → `queueBest` after a valid run → `leaderboard` / `myRank` / `aroundMe`. Economy (optional catalog on the game): `getWallet` / `getInventory` / `getStore` / `purchaseItem` / `useItem` / `claimReward` / `submitIapPurchase`. `deleteMyData` for erasure. Offline queue is local; 4xx except 401/429 drops the run; 401 refreshes then retries. Maintainers publish with GitHub Actions trusted publishing (workflow `publish-sdk.yml`, GitHub user + repo, no org, no `NPM_TOKEN`). Docs: `docs/src/content/docs/sdk.md` and `docs/src/content/docs/economy.md`. Never publish `@gamercury/bantam` (server).
7. Gameplay stays playable with login cancelled or the API down.

## Adapter contract (short)

Default export (or named `adapter`) implements `GameAdapterV1`: `id`, `version`, `boards`, `validateAndDerive(payload, context) → { normalized, values }`. Unknown payload fields must throw. Derived `values[]` are `{ boardId, periodKey, value }` with `periodKey` `"all_time"` or `YYYY-MM-DD` UTC for `daily`. `.ts` is not loaded at runtime.

## Verify (Bantam repo)

`npm run verify` is the gate. Do not skip format, lint, typecheck, tests, build, or OpenAPI drift. Adapter/container/backup lanes listed in the README remain blockers when you change those surfaces.

Do not create remotes, deploy Docker images, or publish npm packages without explicit owner approval. Approved SDK publishes use git tag `sdk-v*` (trusted publishing on `publish-sdk.yml`) or local `npm run sdk:publish` with 2FA. No `NPM_TOKEN`.
