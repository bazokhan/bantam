---
title: API and SDK reference
description: HTTP endpoints, errors, sessions, and typed client usage.
---

The generated [OpenAPI JSON](/reference/bantam.openapi.json) is copied from the service repository. Run `npm run reference:check` to detect drift.

## System

| Method | Path            | Authentication         |
| ------ | --------------- | ---------------------- |
| GET    | `/healthz`      | Public                 |
| GET    | `/readyz`       | Public                 |
| GET    | `/version`      | Public                 |
| GET    | `/openapi.json` | Public                 |
| GET    | `/metrics`      | Optional monitor token |

## Game API

All paths begin `/v1/games/{gameId}`.

| Method | Path                                | Purpose                                            |
| ------ | ----------------------------------- | -------------------------------------------------- |
| POST   | `/auth/exchange`                    | Exchange a PGS server auth code                    |
| POST   | `/auth/refresh`                     | Rotate a refresh token                             |
| POST   | `/auth/logout`                      | Revoke the refresh family                          |
| POST   | `/runs/{adapterId}`                 | Submit evidence for authoritative derivation       |
| GET    | `/flags`                            | Read server-resolved feature flags (public)        |
| GET    | `/leaderboards/{boardId}`           | Page through entries (public; Bearer optional)     |
| GET    | `/leaderboards/{boardId}/me`        | Get the caller’s rank (Bearer)                     |
| GET    | `/leaderboards/{boardId}/around-me` | Get neighboring entries (Bearer)                   |
| DELETE | `/player`                           | Delete the caller’s Bantam data                    |
| GET    | `/economy/wallet`                   | Integer balances (Bearer)                          |
| GET    | `/economy/inventory`                | Owned items (Bearer)                               |
| GET    | `/economy/store`                    | Active offers and authoritative prices (Bearer)    |
| POST   | `/economy/purchases`                | `{ offerId, requestId }` (Bearer)                  |
| POST   | `/economy/items/use`                | `{ itemId, requestId }` (Bearer)                   |
| POST   | `/economy/rewards/claim`            | `{ rewardId, requestId }` (Bearer)                 |
| POST   | `/economy/iap`                      | `{ purchaseToken, productId, provider? }` (Bearer) |

Errors use `{ "error": { "code", "message", "requestId" } }`. Treat `401` as a refresh or reauthentication signal, `409 run-id-conflict` as tampering or a broken client ID generator, and `429` as retryable with backoff.

### Feature flags

`GET /v1/games/{gameId}/flags` returns `{ "flags": [{ "key", "enabled", "value" }] }`.

Flags are set by operators in the admin dashboard, never by clients. `enabled` is the rollout decision for the caller:

- A flag that is off is always `false`.
- A flag at `100%` rollout is `true` for everyone, including signed-out callers.
- A flag between `1%` and `99%` is resolved per signed-in player. Anonymous callers always get `false`, because there is no stable id to bucket.
- The decision is `HMAC-SHA256(flagKey + ":" + playerId, per-game identity salt)`, so it is stable across restarts and across server instances, and cannot be correlated between different games.
- `value` is the configuration string only when `enabled` is `true` for this caller; otherwise it is `null`.

The endpoint accepts an optional `Bearer` token. Send one when signed in; without it you still get fully-rolled-out flags, so gameplay works with login cancelled. Never put a secret in `value`. Operators may define at most 64 flags per game; rollout percent on write must be an integer `0`–`100`.

### Economy

Optional per-game catalog in the manifest (`economy`). Persistence is additive migration `005_economy_shop.sql`. Clients never submit a price or balance. See [Game economy](/economy/) for the catalog shape, IAP flow, and threat model.

`requestId` is a per-player idempotency key. Catalog `rewards` are allowlisted and capped; they are not mission-completion hooks. IAP grants happen only after Google Play verification. Tokens are hashed, never logged.

## TypeScript SDK

Install from the public registry (not a sibling `file:` path). Publish workflow: [SDK on npm](/sdk/).

```ts
import { BantamClient, BrowserStorage } from "@gamercury/bantam-sdk";

const bantam = new BantamClient({
  baseUrl: "https://api.example.com",
  gameId: "demo",
  storage: new BrowserStorage(),
});

const result = await bantam.optionalLogin(() => nativePgs.requestServerAuthCode());
// cancelled/unavailable leaves offline gameplay and queued runs untouched.
```

Provide `queueBest()` with the evidence payload and client-side candidate hints. The SDK refreshes sessions, retains retryable work, discards expired queues, and removes every reference to a successfully accepted run.

```ts
// Read flags. Sends the session automatically when one exists.
const flags = await bantam.getFlags();
const season = flags.find((f) => f.key === "season_badge" && f.enabled)?.value ?? null;

// Convenience for a single boolean gate; `fallback` is used when the flag is absent or the read fails.
if (await bantam.isEnabled("daily_challenge")) {
  enableDailyMode();
}

const wallet = await bantam.getWallet();
await bantam.purchaseItem("life_pack", crypto.randomUUID());
await bantam.submitIapPurchase(playPurchaseToken, "coins_100");
```

## Committed SDK snapshot

The reconciliation check also publishes the exact [typed SDK source snapshot](/reference/bantam-sdk.ts) used by this release, alongside the [OpenAPI snapshot](/reference/bantam.openapi.json).

## See also

- Source repository: <https://github.com/bazokhan/bantam>
- Docker image: [`bazokhan/bantam`](https://hub.docker.com/r/bazokhan/bantam) on Docker Hub
- Marketing page: <https://gamercury.trugraph.io/projects/bantam>
- Studio: [Gamercury Studio](https://gamercury.trugraph.io)
