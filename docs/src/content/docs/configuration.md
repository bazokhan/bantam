---
title: Game manifest and configuration
description: Adapter specs, multi-title isolation, secrets, manifest editing, and PGS v2.
---

## Game manifest

Each entry declares `id`, `displayName`, `adapters`, `secretPrefix`, `gracePeriodHours`, and `authProvider`. The manifest is JSON and is either:

- A file at `$BANTAM_CONFIG_FILE` (default `/etc/bantam/games.json`); if set and the file is readable, it's the source of truth.
- Otherwise `${BANTAM_DATA_DIR}/games.json` (default `/data/games.json`) — the canonical writable path inside the persistent volume.
- If neither exists, the server boots with `games: []` and the admin dashboard offers an editor.

`adapters` is an array of discriminator entries. Use `kind: "generic"` for synthesized trivial games, `kind: "file"` for adapters loaded from the mounted `BANTAM_ADAPTERS_DIR` directory (default `/bantam/adapters`).

```json
{
  "id": "demo",
  "displayName": "Demo",
  "adapters": [
    { "kind": "generic", "boards": [{ "id": "high_score", "direction": "higher", "period": "all_time" }] }
  ],
  "secretPrefix": "BANTAM_GAME_DEMO",
  "gracePeriodHours": 24,
  "authProvider": "development"
}
```

```json
{
  "id": "snake",
  "displayName": "Snake",
  "adapters": [{ "kind": "file", "source": "snake-v1.mjs" }],
  "secretPrefix": "BANTAM_GAME_SNAKE",
  "gracePeriodHours": 48,
  "authProvider": "pgs-v2"
}
```

Set `BANTAM_ONLY_GAME=<id>` to load only that title while preserving the same game-qualified URLs.

Optional `economy` adds currencies, items, store offers, claimable rewards, and Google Play IAP products for that title. The catalog is configuration-only; balances and ownership persist in the game SQLite file. See [Game economy](/economy/).

See [Authoring — Generic boards](/generic-boards/) and [Authoring — File adapters](/adapter-authoring/) for the full contract.

## Editing from the dashboard

The [admin console](/admin-dashboard/) has a Settings page at `/admin/console/settings` (the server-rendered editor remains at `/admin/manifest`). Changes are validated against the same TypeBox schema the boot loader runs, then written atomically (write to `<path>.tmp` then rename). On success the server hot-reloads runtimes; no container restart is needed.

If the manifest path is read-only (e.g. a `:ro` mount in compose), the editor is disabled and a banner explains how to switch to a writable path. Saving a manifest that fails schema validation returns 400 with the error list rendered in the response.

## Per-game secrets

For `secretPrefix: BANTAM_GAME_DEMO`, supply:

- `BANTAM_GAME_DEMO_IDENTITY_SALT`
- `BANTAM_GAME_DEMO_SESSION_SECRET`
- `BANTAM_GAME_DEMO_CURSOR_SECRET`

For `authProvider: "pgs-v2"`, additionally:

- `BANTAM_GAME_DEMO_PGS_CLIENT_ID`
- `BANTAM_GAME_DEMO_PGS_CLIENT_SECRET`

If the catalog includes `iapProducts` with `provider: "google_play"`, also supply:

- `BANTAM_GAME_DEMO_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

That value is a Google Play service-account JSON object used only for Android Publisher verification. The health page reports presence, never the contents.

Every value must be at least 16 characters (the service-account JSON is longer). Use independent random values per title and purpose. Rotating the identity salt changes player pseudonyms and must be treated as an account migration. Rotating the session secret immediately invalidates access tokens; refresh sessions can then mint new ones only if the signing change is coordinated. **Per-game secrets are read from env at boot and at each manifest reload; rotating requires a container restart.**

## Adapter directory

`BANTAM_ADAPTERS_DIR` (default `/bantam/adapters`) is scanned for compiled `.js`/`.mjs` modules at boot and at each manifest reload. Each module's default export (or named export `adapter`) implements `GameAdapterV1`. The loader rejects modules that don't satisfy the contract and refuses duplicate ids across modules. See [Authoring — File adapters](/adapter-authoring/) for the module shape.

## Play Games Services v2

Create a **Game server** credential in Play Console backed by a Web OAuth client. The Android client requests a single-use server auth code for that exact Web client ID and sends it immediately to `/auth/exchange`.

Bantam exchanges the code, calls `players/me`, derives `HMAC-SHA-256(game salt, provider + player ID)`, and discards the provider access token. It does not request offline provider access or retain provider refresh tokens.

On cancellation or provider/backend failure, the game continues offline and retains its best-only queue. Reauthentication is required when Bantam's rotating refresh-token family expires, is revoked, or detects reuse.
