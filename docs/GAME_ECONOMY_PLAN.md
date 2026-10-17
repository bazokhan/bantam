# Game Economy Extension Plan

Status: Phased implementation plan. Phase 1 is implemented on this branch; phases 2–5 remain
planned pending review and merge.

## Goal

Extend Bantam with a small, reusable, server-authoritative game economy. Moon Gravity is the first consumer, but the API and data model should work for other games.

The scope is wallets/currencies, a transaction ledger, inventory, purchases using virtual currency, and verified real-money in-app purchases (IAP). This is not intended to become a general e-commerce platform.

## Design principles

- The server is authoritative for balances, item ownership, prices, rewards, and purchase outcomes.
- The client may request an operation but cannot choose an authoritative price, set a balance, or directly grant itself an item.
- Persist currency as non-negative integer units; do not use floating-point values.
- Make balance changes, inventory changes, and corresponding ledger records atomic.
- Make mutating operations idempotent so retries and duplicate callbacks cannot grant or charge twice.
- Keep provider-specific IAP verification separate from generic wallet and inventory logic.
- Preserve Bantam's existing per-title SQLite architecture and existing authentication, leaderboards, and feature flags.

## Scope

### 1. Currencies and wallets

Support multiple named currencies per player, for example `coins` and `gems`, without hard-coding one database column per currency.

Suggested table:

```text
wallets
  player_id
  currency_id
  balance
  updated_at
  UNIQUE(player_id, currency_id)
```

Use integer balances and enforce non-negative balances in the service layer and, where practical, database constraints. Create a wallet lazily or initialize configured currencies at player creation.

### 2. Append-only transaction ledger

Every balance change must have a corresponding ledger record. The current wallet balance is the fast read model; the ledger provides an audit trail.

```text
wallet_transactions
  id
  player_id
  currency_id
  amount              // signed integer delta
  reason              // mission_reward, item_purchase, iap_grant, admin_adjustment, ...
  idempotency_key     // unique per player; protects against duplicate operations
  balance_after       // balance after this transaction
  created_at
```

Use a uniqueness rule for the operation reference so the same logical operation cannot be applied twice. Do not edit or delete historical ledger entries as a normal correction mechanism; add compensating transactions instead.

### 3. Item definitions, offers, and inventory

Keep item definitions and store offers server-controlled. Initially, these may be versioned per-title configuration rather than a dynamic catalog-management UI.

Suggested concepts/tables:

- `economy_items`: stable item ID, type, stackability, and game-defined metadata.
- `store_offers`: offer ID, item ID or reward bundle, price currency, price amount, availability and optional limits.
- `inventory`: player ID, item ID, quantity or ownership state, and timestamps.

Support stackable consumables through quantities and permanent/unique items through ownership records. Define item-use semantics per game; Bantam should not assume that it understands a game's combat or gameplay rules.

### 4. Virtual-currency purchases

Provide one server-side purchase operation. The client sends an item/offer ID and an idempotency key, not a price.

Within a single database transaction:

1. Authenticate the player and validate the request.
2. Load the active offer and its authoritative price.
3. Check balance, ownership rules, offer limits, and other configured restrictions.
4. Deduct the currency.
5. Grant the item or bundle.
6. Record the wallet ledger entry and durable purchase result.
7. Commit; on any failure, roll back all changes.

Protect against concurrent requests and double-spending with SQLite transactions and appropriate constraints. Repeating the same request ID should return the original outcome rather than charge again.

### 5. Real-money IAP

Start with Google Play as the first provider; keep provider-specific code behind an adapter so other stores can be added later.

Suggested concepts:

- `iap_products`: provider and product ID mapped to a server-defined reward/bundle.
- `iap_purchases`: player, provider, product ID, unique purchase token/transaction ID, verification state, fulfillment state, timestamps, and relevant provider metadata.

Flow:

1. The game initiates the purchase using the platform billing SDK.
2. The client submits the purchase token to Bantam.
3. Bantam verifies the token and product/status with the provider's server API.
4. Bantam checks that the transaction is valid, belongs to the expected product, and has not already been fulfilled.
5. In a database transaction, record fulfillment and grant the configured currency/items exactly once.
6. Complete the provider's required acknowledgment or consumption step and retry safely if it fails.
7. Process relevant refund, revocation, and subscription events if supported.

Never grant value based solely on a client-provided success flag or product ID. Keep provider credentials server-side. Model verification and fulfillment separately so interrupted workflows can resume safely.

For the first release, focus on consumable Google Play products that grant coin packs. Do not implement subscriptions or other stores until there is a concrete need.

### 6. Admin operations

Provide authorized, audited operations to grant or deduct currency, adjust inventory, and inspect a player's ledger and purchase status. Manual changes must use the same ledger and consistency rules as normal economy operations.

## Proposed API / SDK surface

Exact names should follow Bantam's existing conventions.

- `getWallet()`
- `getInventory()`
- `getStore()`
- `purchaseItem(offerId, requestId)`
- `useItem(itemId, requestId)` (only where supported)
- `claimReward(rewardId, requestId)` (only for server-validated rewards)
- `submitIapPurchase(purchaseToken)`

Do not expose ordinary client methods such as `setBalance` or unrestricted `grantItem`. Reward-claim endpoints must validate eligibility on the server; otherwise clients could mint currency by repeatedly claiming arbitrary reward IDs.

## Suggested implementation phases

### Phase 1 — Economy foundation (implemented on this branch)
- Define currency IDs and validation rules.
- Add migrations for wallets and ledger.
- Implement atomic credit/debit operations and idempotency.
- Add unit and integration tests for insufficient balance, duplicate requests, concurrent spending, rollback, and ledger consistency.

### Phase 2 — Inventory and virtual shop
- Add item definitions, offers, and inventory persistence.
- Implement store listing and server-priced item purchases.
- Support stackable and permanent items.
- Test purchase retries, ownership constraints, inactive offers, and concurrent requests.

### Phase 3 — Google Play IAP
- Add provider product mapping and purchase records.
- Implement server-side token verification and one-time fulfillment.
- Handle acknowledgment/consumption retries, duplicate tokens, invalid tokens, and refund/revocation policy.
- Keep credentials and provider API calls on the server.

### Phase 4 — SDK, docs, and administration
- Add typed SDK methods and API documentation.
- Add audited admin adjustments and purchase/ledger inspection.
- Document threat model, idempotency semantics, and operational recovery.

### Phase 5 — Moon Gravity integration
- Configure coin-pack products and offers.
- Display wallet, inventory, and store state from Bantam.
- Route virtual purchases through the server.
- Integrate Google Play Billing and submit tokens to Bantam.
- Test interrupted purchases, duplicate callbacks, forged client requests, and reinstall/device-change behavior.

## Explicitly out of scope for the initial version

- Player-to-player transfers, gifting, trading, auctions, or marketplaces.
- Subscriptions and multiple IAP providers.
- A sophisticated visual store/catalog editor.
- Game-specific gameplay logic such as deciding whether a player has earned a mission reward, unless that validation is explicitly implemented by the game's server-side adapter.

## Acceptance criteria

- A client cannot set its balance, forge an authoritative price, or grant itself inventory.
- A purchase either deducts currency and grants the item together, or does neither.
- Duplicate request IDs and duplicate IAP tokens cannot grant value twice.
- Concurrent purchases cannot spend the same balance twice or produce negative balances.
- Every balance change is auditable through the ledger.
- IAP rewards are granted only after server-side provider verification.
- Existing Bantam functionality continues to work without regression.

## Open design decisions

- Confirm the existing player identity key and database migration conventions before implementation.
- Decide whether item/offer definitions are configuration-only or persisted in tables for the first version.
- Specify retention and privacy rules for provider purchase metadata.
- Define game-specific refund policy for already-spent consumable currency; never assume a refund can safely be represented as a simple negative balance.
- Confirm the exact Google Play API and acknowledgment/consumption flow against the current integration and provider requirements before implementation.
