---
title: Game manifest and configuration
description: Adapter specs, multi-title isolation, secrets, and PGS v2.
---

## Game manifest

Each entry declares `id`, `displayName`, `adapters`, `secretPrefix`, `gracePeriodHours`, and `authProvider`. Set `BANTAM_ONLY_GAME=<id>` to load only that title while preserving the same game-qualified URLs.

`adapters` is an array of discriminator entries. Use `kind: "generic"` for synthesized trivial games, `kind: "file"` for adapters loaded from the mounted `/bantam/adapters` directory.

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

See [Authoring — Generic boards](/generic-boards/) and [Authoring — File adapters](/adapter-authoring/) for the full contract.

## Per-game secrets

For `secretPrefix: BANTAM_GAME_DEMO`, supply:

- `BANTAM_GAME_DEMO_IDENTITY_SALT`
- `BANTAM_GAME_DEMO_SESSION_SECRET`
- `BANTAM_GAME_DEMO_CURSOR_SECRET`

For `authProvider: "pgs-v2"`, additionally:

- `BANTAM_GAME_DEMO_PGS_CLIENT_ID`
- `BANTAM_GAME_DEMO_PGS_CLIENT_SECRET`

Every value must be at least 16 characters. Use independent random values per title and purpose. Rotating the identity salt changes player pseudonyms and must be treated as an account migration. Rotating the session secret immediately invalidates access tokens; refresh sessions can then mint new ones only if the signing change is coordinated.

## Adapter directory

`BANTAM_ADAPTERS_DIR` (default `/bantam/adapters`) is scanned for compiled `.js`/`.mjs` modules at boot. Each module's default export (or named export `adapter`) implements `GameAdapterV1`. The loader rejects modules that don't satisfy the contract and refuses duplicate ids across modules. See [Authoring — File adapters](/adapter-authoring/) for the module shape.

## Play Games Services v2

Create a **Game server** credential in Play Console backed by a Web OAuth client. The Android client requests a single-use server auth code for that exact Web client ID and sends it immediately to `/auth/exchange`.

Bantam exchanges the code, calls `players/me`, derives `HMAC-SHA-256(game salt, provider + player ID)`, and discards the provider access token. It does not request offline provider access or retain provider refresh tokens.

On cancellation or provider/backend failure, the game continues offline and retains its best-only queue. Reauthentication is required when Bantam's rotating refresh-token family expires, is revoked, or detects reuse.
