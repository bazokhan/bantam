---
title: Versioning and changelog
description: Service, API, adapter, schema, and documentation versions.
---

## Version policy

- Service releases use semantic versions.
- Compatible API additions are minor; incompatible HTTP or SDK changes require a major release and migration guide.
- Adapter IDs and rule versions are immutable contracts. Result-changing rules use a new version.
- Database migrations are monotonic and checksummed. They are not tied one-to-one to the service version.
- Documentation snapshots must pass OpenAPI reconciliation for the release commit.

## 0.3.0 - game economy

Compatible API addition (minor). Additive migrations `004_economy.sql` and `005_economy_shop.sql`.

- Per-player wallets and an append-only currency ledger. Credits and debits are positive safe integers, non-negative, and idempotent per player.
- Manifest `economy` catalog for currencies, items, offers, claimable rewards, and Google Play IAP products. Inventory and store purchases persist in SQLite.
- Player API: `GET /economy/wallet|inventory|store`, `POST /economy/purchases`, `POST /economy/items/use`, `POST /economy/rewards/claim`, `POST /economy/iap`.
- Google Play consumable verification via the Android Publisher API. Tokens are hashed; fulfillment is once; acknowledgment retries on resubmit; refunds are recorded and not auto-clawed back.
- Admin player page for ledger, inventory, purchases, and audited `admin_adjustment` writes.
- SDK adds `getWallet`, `getInventory`, `getStore`, `purchaseItem`, `useItem`, `claimReward`, and `submitIapPurchase`. Next npm publish is tag `sdk-v0.3.0`.
- Docs: homepage and sidebar cover leaderboards, flags, economy, admin, and auth. Feature pages: [Leaderboards](/leaderboards/), [Feature flags](/flags/), [Game economy](/economy/).

This entry describes the 0.3.0 source. Container, npm, and host deploy status are separate from this file.

## 0.2.0 - feature flags

Compatible API addition (minor). Additive migration `003_feature_flags.sql`.

- Per-game feature flags, stored in each game's own SQLite file.
- `GET /v1/games/{gameId}/flags` returns `{ flags: [{ key, enabled, value }] }`. Read-only to clients; optional `Bearer` so signed-out callers still receive fully-rolled-out flags.
- Rollout resolution is deterministic: `HMAC-SHA256(flagKey + ":" + playerId, ${secretPrefix}_IDENTITY_SALT)`, stable across restarts and instances, and not correlatable across games. Flags below 100% resolve per signed-in player and resolve `false` when anonymous.
- Admin UI at `/admin/games/{id}/flags`: create, edit, enable/disable, and confirm-guarded delete. Invalid writes redirect with an error banner. Max 64 flags per game. All writes are session-gated and logged.
- SDK `@gamercury/bantam-sdk` **0.2.0** adds `getFlags()` and `isEnabled(key, fallback?)`. `isEnabled` returns `fallback` when the flag is missing or the read fails. npm publish is tag `sdk-v0.2.0`.
- Flag `description` is operator-facing and never sent to clients. `value` is sent only when the flag resolves on for that caller and must never hold a secret.

This entry describes the 0.2.0 source. Container, npm, and host deploy status are separate from this file.

## 0.1.0 - local foundation

- Multi-title Fastify service with isolated WAL databases and safe migrations.
- PGS v2 and development authentication providers with rotating Bantam sessions.
- Higher/lower permanent and daily boards, ranks, pagination, surrounding results, idempotency, deletion, and rate limits.
- Game-agnostic adapter contract: file-based loaders from a mounted directory plus a synthesized `generic` adapter for trivial games.
- Token-gated read-only admin UI.
- Litestream/MinIO local replication and guarded recovery commands.
- Typed TypeScript SDK, OpenAPI snapshot, tests, container, Compose, CI, and this Starlight site.

This entry describes local implementation only. It does not claim a remote repository, production credentials, cloud bucket, Coolify deployment, PGS validation, or external release.

## 0.1.0 — production wiring

- Client SDK `@gamercury/bantam-sdk` is the public npm package (`packages/sdk`). Publish with `sdk-v*` tags via GitHub Actions trusted publishing (`publish-sdk.yml`, no `NPM_TOKEN`) or local `npm run sdk:publish`. The server package stays private.
- Source published to a private GitHub repository at <https://github.com/bazokhan/bantam>.
- Container image published to Docker Hub as [`bazokhan/bantam`](https://hub.docker.com/r/bazokhan/bantam). CI publishes the `latest` tag plus the short commit SHA on every push to `main`, and a versioned tag on each `v*` release tag.
- Documentation site deployed to <https://bantam.trugraph.io> via Vercel, auto-deployed from `docs/` on every push to `main`.
- Featured under the **Projects** section on <https://gamercury.trugraph.io/projects/bantam>.
- Repository and image references in the docs were updated from the placeholder `gamercury/bantam` namespace to the live `bazokhan/bantam` namespace.
