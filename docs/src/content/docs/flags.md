---
title: Feature flags
description: Per-game, server-resolved flags with deterministic rollout. Clients only read.
---

Every Bantam game can ship feature flags without a third-party flag service. Operators write them in the admin dashboard. Clients only read a server-resolved answer. Gameplay must stay playable when the read fails or the player is signed out.

Flags are stored in that game's own SQLite file (`003_feature_flags.sql`). They are not in `games.json`. A change takes effect on the next client read — no restart.

## What a flag is

| Field            | Who sees it | Rules                                                                                        |
| ---------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `key`            | Everyone    | `^[a-z0-9][a-z0-9._-]{0,63}$`. Immutable after create.                                       |
| `description`    | Operators   | Up to 200 characters. Never sent to clients.                                                 |
| `enabled`        | Resolved    | Master switch. Off is always `false` for every caller.                                       |
| `rolloutPercent` | Operators   | Integer `0`–`100`. See [Rollout](#rollout).                                                  |
| `value`          | Conditional | Up to 500 characters. Sent only when the flag resolves on for that caller; otherwise `null`. |

Never put a secret in `value`. Cap is 64 flags per game.

## Client API

`GET /v1/games/{gameId}/flags` returns `{ "flags": [{ "key", "enabled", "value" }] }`.

Bearer is optional. Send a session when the player is signed in so partial rollouts can resolve. Called signed out, the endpoint still returns flags that are fully rolled out, so a cancelled login does not take down gameplay.

SDK:

```ts
const flags = await bantam.getFlags();
if (await bantam.isEnabled("daily_challenge")) enableDailyMode();

const season = flags.find((f) => f.key === "season_badge" && f.enabled)?.value ?? "s1";
```

`isEnabled(key, fallback)` returns `fallback` (default `false`) when the flag is missing or the request fails. Treat a missing flag as off and keep a local default.

## Rollout

`enabled` in the public payload is the decision for **this caller**, not the operator's master switch copied verbatim.

- Master switch off → `false` for everyone.
- `100%` rollout → `true` for everyone, including signed-out clients.
- `1%`–`99%` → resolved per signed-in player. Anonymous callers always get `false` (no stable id to bucket).
- The bucket is `HMAC-SHA256(flagKey + ":" + playerId, ${secretPrefix}_IDENTITY_SALT)`. The same player keeps the same answer across restarts and instances. Buckets cannot be correlated across games because the salt is per-title.

## Admin

`/admin/games/{id}/flags` is the only writer. Create, edit, enable/disable, and confirm-guarded delete. Invalid keys or a 65th flag show an error banner; keys are not auto-corrected. Every write is session-gated and logged with the admin identity, game, flag key, and action.

See [Admin dashboard](/admin-dashboard/#feature-flags) for the route table.

## What flags are not

- Not a remote-config CMS for large payloads. `value` is a short string.
- Not a secret store. Presence in the public API is enough to treat `value` as public.
- Not a replacement for adapter validation. A flag can gate a mode; the adapter still derives scores from evidence.

## See also

- [API and SDK](/reference/#feature-flags)
- [SDK on npm](/sdk/#feature-flags)
- [Admin dashboard](/admin-dashboard/#feature-flags)
- [Changelog 0.2.0](/changelog/)
