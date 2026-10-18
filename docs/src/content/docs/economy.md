---
title: Game economy
description: Server-authoritative wallets, inventory, virtual shop, and Google Play IAP.
---

Bantam can host a small, reusable economy for any title. The server owns balances, prices, ownership, and IAP fulfillment. Clients send evidence — an offer id, a request id, or a store purchase token — never a price or a balance.

a game is the first intended consumer. This repository stays game-agnostic: each title declares its catalog in `games.json`. Gameplay integration (UI, Google Play Billing SDK, mission rewards) lives in the game repo.

## What the server owns

- Integer currency balances and an append-only wallet ledger.
- Inventory quantities and an inventory ledger.
- Catalog prices for virtual offers.
- One-time Google Play consumable fulfillment after provider verification.

Clients cannot `setBalance`, forge a price, or grant themselves items. A purchase either deducts currency and grants the item together, or does neither. Duplicate request ids and duplicate IAP tokens do not grant twice.

## Catalog (configuration)

Item definitions, offers, claimable rewards, and IAP products are versioned per title in the game manifest. Operators edit them in the admin Manifest form; Advanced JSON remains for add/remove game and adapter specs. A save validates the same catalog schema the runtime uses.

```json
{
  "economy": {
    "currencies": [{ "id": "coins" }],
    "items": [
      { "id": "extra_life", "type": "consumable", "stackable": true, "usable": true },
      { "id": "gold_skin", "type": "permanent", "stackable": false }
    ],
    "offers": [
      {
        "id": "life_pack",
        "itemId": "extra_life",
        "quantity": 3,
        "priceCurrencyId": "coins",
        "priceAmount": 50,
        "active": true
      }
    ],
    "rewards": [
      {
        "id": "starter_pack",
        "grants": [{ "kind": "currency", "currencyId": "coins", "amount": 100 }],
        "maxClaims": 1
      }
    ],
    "iapProducts": [
      {
        "id": "coins_100",
        "provider": "google_play",
        "providerProductId": "coins_100",
        "packageName": "com.example.game",
        "grants": [{ "kind": "currency", "currencyId": "coins", "amount": 100 }]
      }
    ]
  }
}
```

Rules: ids are `^[a-z][a-z0-9_-]{0,47}$`. Permanent items cannot be stackable and must be sold as quantity `1`. Offers and grants must reference currencies and items in the same catalog. `rewards` are catalog allowlists with a per-player claim cap (default 1). They are **not** mission-completion hooks; a game adapter does not currently mint currency from run evidence.

## Player API

All paths begin `/v1/games/{gameId}` and require a Bearer session.

| Method | Path                     | Body                                      | Purpose                                     |
| ------ | ------------------------ | ----------------------------------------- | ------------------------------------------- |
| GET    | `/economy/wallet`        |                                           | Current integer balances                    |
| GET    | `/economy/inventory`     |                                           | Owned items with quantity > 0               |
| GET    | `/economy/store`         |                                           | Active offers and authoritative prices      |
| POST   | `/economy/purchases`     | `{ offerId, requestId }`                  | Buy with virtual currency                   |
| POST   | `/economy/items/use`     | `{ itemId, requestId }`                   | Use a catalog `usable` item                 |
| POST   | `/economy/rewards/claim` | `{ rewardId, requestId }`                 | Claim a catalog reward                      |
| POST   | `/economy/iap`           | `{ purchaseToken, productId, provider? }` | Submit a Google Play token for verification |

`requestId` is a per-player idempotency key (1–128 printable characters). Repeating the same key with the same operation returns the original outcome. Reusing it for a different operation returns `409 idempotency-conflict`.

Use semantics: a usable consumable decrements quantity by 1. A usable permanent records the use and leaves quantity unchanged. Items without `usable: true` are rejected.

## Google Play IAP

1. The game charges through Play Billing and receives a purchase token.
2. The client sends that token and the Play product id to `POST /economy/iap`.
3. Bantam looks up the catalog product, then verifies the token with the Android Publisher API. The client product id is only a lookup key; grants come from the catalog after verification.
4. A purchased consumable is fulfilled exactly once inside a SQLite transaction.
5. Bantam acknowledges the token. If acknowledgment fails, fulfillment stands; the next submit of the same token retries acknowledgment.

Provider credentials are server-side only: `${secretPrefix}_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` must contain a Google Play service-account JSON object (names only — never commit the value). Without it, IAP submit returns `503 iap-not-configured`.

Refunded or canceled tokens are recorded and **not** fulfilled. Already-fulfilled purchases that later refund are marked refunded and are **not** automatically clawed back. Spent consumable currency cannot safely be inverted with a negative balance.

Purchase tokens are hashed for uniqueness, never logged, and never shown in the admin UI.

## Admin

`/admin/games/:id/players/:playerId` shows wallet, ledger, inventory, store purchases, and IAP state (no tokens). Operators may credit or debit currency and grant or remove catalog items. Those writes use `admin_adjustment` and the same ledgers as player operations. Every write is session-gated and logged with a truncated player id.

## SDK

```ts
const wallet = await bantam.getWallet();
const store = await bantam.getStore();
await bantam.purchaseItem("life_pack", requestId);
await bantam.submitIapPurchase(purchaseToken, "coins_100");
```

See [API and SDK](/reference/) for the full method list.

## Wiring a game (including a game)

This server does not ship a game configuration. In the game repo:

1. Add an `economy` catalog to that title's `games.json` entry (coin packs, skins, starter reward).
2. Install `@gamercury/bantam-sdk` and render wallet, inventory, and store from the methods above.
3. Route virtual purchases through `purchaseItem`. Do not apply local prices.
4. Integrate Google Play Billing; on success, call `submitIapPurchase` with the token from the store, not a client success flag.
5. Test interrupted purchases, duplicate callbacks, forged prices, and reinstall/device-change (same Play account, new device) — the token is the idempotency key.

Mission rewards stay out of this API until a game adapter can prove eligibility. Until then, grant value through catalog rewards, IAP, purchases, or admin adjustments.

## Threat model

| Client attempt                         | Server result                                     |
| -------------------------------------- | ------------------------------------------------- |
| Submit a price or set a balance        | Rejected (`additionalProperties` / no such route) |
| Claim an unknown reward id             | `404 reward-not-found`                            |
| Repeat a successful `requestId`        | Original outcome, `replayed: true`                |
| Reuse a `requestId` for another action | `409 idempotency-conflict`                        |
| Concurrent spend past the remainder    | One succeeds; the other `409 insufficient-funds`  |
| IAP success flag without a token       | No grant                                          |
| IAP token that Google marks canceled   | `409 iap-refunded`, no grant                      |
| Duplicate IAP token                    | Replay; no second grant                           |

Operational recovery: compensating ledger entries, never edits of historical rows. Restore still targets one game database with `--force` while the writer is stopped.
