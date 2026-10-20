# Admin console — architecture and feature-gap analysis

Written 2026-10-20, after replacing the server-rendered admin dashboard with a
React console modelled on the `game-forge-hub` prototype.

## What shipped

| Piece             | Location                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| React console     | `packages/admin-ui` (Vite + React 19 + Tailwind v4 + TanStack Router + React Query + Recharts) |
| JSON API          | `src/admin/api.ts` (routes under `/admin/api/*`)                                               |
| Wire schemas      | `src/admin/api-schemas.ts` (TypeBox, request + response)                                       |
| Static serving    | `src/admin/spa.ts`                                                                             |
| Session gate      | `src/admin/middleware.ts`                                                                      |
| Analytics queries | `src/db/game-database.ts`, `migrations/006_admin_analytics.sql`                                |

The console is served at `/admin/console/`. `/admin/` redirects there. The old
server-rendered dashboard remains at `/admin/legacy` as a no-JavaScript
fallback.

### Boundaries that were kept

- The session cookie is still `HttpOnly`, `SameSite=Strict`, `Path=/admin/`.
  No token or secret ever reaches JavaScript. The console only ever reads
  server-derived JSON.
- Every leaderboard value is derived by the versioned server adapter inside the
  run transaction. The console has no write path for scores.
- The console never renders an env-var _value_ — only present/missing.
- `SameSite=Strict` is the CSRF defence. The JSON API answers `401` with a JSON
  body instead of redirecting, so the console can react rather than follow a
  redirect into the login page's HTML.
- Request bodies are schema-validated and reject unknown fields.

## Prototype feature inventory vs. Bantam

The prototype's plan lists sixteen surfaces. Here is where each one lands.

| Prototype surface                                                       | Bantam status                              | Server cost to close the gap      |
| ----------------------------------------------------------------------- | ------------------------------------------ | --------------------------------- |
| App shell (sidebar, game switcher, breadcrumbs, ⌘K palette, light/dark) | **Shipped**                                | —                                 |
| Overview (KPIs, charts, health, recent activity)                        | **Shipped**                                | —                                 |
| Players (table, detail, wallet ledger, inventory, purchases)            | **Shipped**                                | —                                 |
| Purchases (provider/status filters, validation history)                 | **Shipped** (IAP states + store purchases) | —                                 |
| Feature flags (toggles, rollout, edit)                                  | **Shipped** (rollout % only)               | targeting rules — see Tier 2      |
| Leaderboards (boards, periods, ranked entries)                          | **Shipped** (read-only)                    | board config editing — see Tier 2 |
| Economy (currencies, items, offers)                                     | **Shipped** (read-only + grant/debit)      | —                                 |
| Integrations (PGS, Game Center, FCM, APNs)                              | **Partial** — PGS v2 + env presence        | per provider — see Tier 3         |
| Settings (identity, app versions, environments)                         | **Partial** — manifest editor              | app versions — see Tier 2         |
| Wallets (grant/debit with reason)                                       | **Shipped**                                | —                                 |
| Inventory (grant/remove)                                                | **Shipped**                                | —                                 |
| Config (typed table, environment-aware)                                 | **Not supported**                          | Tier 2                            |
| Content (draft/publish/rollback)                                        | **Not supported**                          | Tier 3                            |
| Achievements                                                            | **Not supported**                          | Tier 3                            |
| Events (scheduled, timed)                                               | **Not supported**                          | Tier 2                            |
| Messages (announcements, push, audiences)                               | **Not supported**                          | Tier 3                            |
| MCP & API (service keys, tool catalog, agent audit)                     | **Not supported**                          | Tier 3                            |
| Environment switcher (dev/staging/prod)                                 | **Not applicable** — see below             | —                                 |

### The environment switcher is not a gap

The prototype switches between environments inside one console. Bantam does not
work that way: one deployment serves exactly one `environment`, taken from the
manifest (`src/config.ts:60`, `src/admin/manifest-store.ts:43`). Running three
environments means three deployments. A switcher in the UI would be a fiction,
so the console shows the current environment as read-only instead.

---

## Tier 1 — cheap: the server already has the capability

These need an endpoint and a screen, not a new domain. The service layer
already enforces reason formats, idempotency and immutability, so the console
only supplies inputs.

### 1. Wallet grant / debit with a reason — **already shipped in this change**

`GameDatabase.creditCurrency` / `debitCurrency` (`src/db/game-database.ts:194`,
`:207`) already record a reason and an idempotency key, and
`wallet_transactions` is append-only. The legacy admin exposed this at
`POST /admin/games/:id/players/:playerId/currency`
(`src/admin/routes.ts:799`). The console now has the equivalent at
`POST /admin/api/games/:gameId/players/:playerId/currency`.

**Cost:** done. The only caveat is the idempotency key — the client generates
one per opened dialog so a double submit cannot double-credit.

### 2. Inventory grant / remove — **already shipped in this change**

`GameDatabase.grantItem` / `consumeItem` (`src/db/game-database.ts:778`, `:791`).
Same shape as above, at `POST /admin/api/games/:gameId/players/:playerId/item`.

### 3. Per-player leaderboard entries — **shipped**

`db.playerEntry` (`:468`) and `db.around` (`:486`) already answer "where does
this player sit on this board" and "who is around them".

**Shipped as** `GameDatabase.playerEntries` (`src/db/game-database.ts`), one row
per board and period the player appears on, with the rank they hold. The rank
uses the same rule as the board listing — a strict comparison on the value, so
tied scores share a rank — and the board's `direction` decides which side is
better. The rank is computed in SQL with a correlated count over
`leaderboard_entries`, so it is derived from the same rows the board page
shows rather than recomputed in the console.

Migration `008_leaderboard_player_index.sql` adds an index on
`leaderboard_entries(player_id, board_id, period_key)`. The existing
`UNIQUE(board_id, period_key, player_id)` index cannot serve a player-first
filter because the player id is the last column. The index is purely
additive.

Served at `GET /admin/api/games/:gameId/players/:playerId/entries`, and shown
in the player drawer.

### 4. Operator-initiated reward claim

`db.claimReward` (`src/db/game-database.ts:970`) enforces `maxClaims` and
idempotency. Rewards are declared in the manifest catalog
(`catalog.rewards`, `src/services/economy.ts:66`).

**Cost:** one endpoint plus a dialog. No migration. **Not shipped yet.**

### 5. Economy summary — **shipped on the game Economy page**

`runtime.game.economy` already carries the full catalog, and
`db.offerPurchaseCounts` (`:769`) the per-offer purchase counts.

**Shipped as** `GameDatabase.economySummary` (`src/db/game-database.ts`): the
outstanding balance of every currency, the quantity held of every item, how
many players hold each, and the velocity of the two ledgers (today and total).
Every figure is a count or a sum over tables the game database already holds —
no new table, no new write path.

Served inside the existing `GET /admin/api/games/:gameId/economy` response as
`summary`, and rendered on the game Economy page.

The gap analysis originally suggested the overview. The summary is
game-scoped (one game has one economy, one wallet and one inventory), and the
overview is the cross-game page, so it sits on the Economy page instead where
it has the game context it needs.

### 6. Inventory ledger in the player drawer — **shipped**

`db.listInventoryTransactions` (`:737`) was not surfaced, so the player drawer
showed quantities but not their history.

**Shipped as** an `inventoryLedger` array on the existing player-detail
payload: item, signed amount, balance after the change, reason and timestamp.
No new endpoint, no migration.

### 7. An admin audit trail — **shipped**

Today every destructive action (player delete, flag delete, manifest save,
currency adjustment) leaves only a container log line. There is no queryable
record of _who_ did _what_ to _which_ object.

**Shipped as** migration `007_admin_audit.sql`:

```sql
CREATE TABLE admin_audit (
  id INTEGER PRIMARY KEY,
  admin_id TEXT,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  game_id TEXT,
  target TEXT,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX admin_audit_created ON admin_audit(created_at DESC, id DESC);
CREATE INDEX admin_audit_game ON admin_audit(game_id, created_at DESC, id DESC);
CREATE INDEX admin_audit_action ON admin_audit(action, created_at DESC, id DESC);
```

The table lives in the server-level admin database, so one query shows every
operator action across every game, and the trail survives a game database
being reset. It is append-only: nothing in the server updates or deletes an
audit row.

The rows obey the same rules as the rest of the admin: no bodies, no
credentials, no tokens, no IP addresses, no unredacted headers, and no raw
provider ids. `details` is a small JSON object the server builds itself and
holds only what the operator typed — the amount, the currency or item id, and
the reason.

`target` holds the full Bantam player id. That is Bantam's own opaque
identifier, not a provider id, and the same authenticated admin already
receives it from `/admin/api/games/:id/players`; a trail that cannot identify
the object it describes is not worth having. The pino log lines are
unaffected and still truncate ids the way `truncateId` does
(`src/admin/routes.ts:78`).

The nine recorded actions are `flag.write`, `flag.toggle`, `flag.delete`,
`player.delete`, `currency.credit`, `currency.debit`, `item.grant`,
`item.remove` and `manifest.save`. Served at `GET /admin/api/audit` with
`limit`, `action` and `gameId` filters, and shown on the Audit screen.

### 8. Store / IAP purchase reporting

`listIapPurchases` (`:1034`) already returns verification, fulfilment and
acknowledgement state per purchase, and `listStorePurchases` (`:748`) returns
the in-game purchase history. The console shows both per player; a per-game
rollup (purchases per offer, IAP state counts) is one aggregate query.

**Cost:** trivial. Note this is _volume_, not revenue — the catalogue has no
fiat price, only in-game currency amounts.

---

## Tier 2 — medium: a new table or a hot-path change

### 9. Feature-flag targeting beyond the rollout percentage

The prototype targets on app version, platform, country and date. Bantam's
flags only have a percentage bucket (`src/services/feature-flags.ts:42`).

**Cost:** a `targeting` JSON column on `feature_flags` (migration) plus
evaluation changes inside `resolveFlags` — which runs on **every client flag
read**, the hottest read path in the server. The bucket must stay
deterministic per player. This is the only Tier-2 item that touches a hot
path, and it is the one most likely to cause a subtle bug if rushed. Do it
with golden fixtures.

### 10. A typed per-game config table

A `game_config` table (key, value, updated_at) with CRUD in the console, and
eventually a client read API. The feature-flag table is already a close
analogue and its admin surface can be copied.

**Cost:** one migration plus CRUD plus a read API if clients need it.

### 11. Timed events

An `events` table (id, starts_at, ends_at, payload) with scheduling in the
console and a client read endpoint that returns the events currently live.

**Cost:** one migration, a scheduler, a read API and a console screen. The
events that count for a game are usually few, so the scheduler can be a read
filter rather than a job.

### 12. App versions in the manifest

The prototype tracks app versions per environment and targets flags at them.
Adding `appVersion` to the manifest's game entry is a schema change with no
migration — but it changes the manifest contract, the boot validation and the
SDK surface, so it needs a plan, not a patch.

---

## Tier 3 — large: a new domain model or an external provider

These are new product areas, not admin surfaces. Bantam is deliberately small,
and the prototype's own plan says to keep the vocabulary to the requested
domains. Each of these would roughly double a subsystem.

| Feature                                               | Why it is large                                                                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Content versioning** (draft / published / rollback) | Needs a content model, a version table and a publish pipeline. The console's JSON workspace and the manifest save/rollback flow are reusable, but the domain is new.                     |
| **Achievements**                                      | New tables for definitions, progress and unlocks, plus a client read API. The GPGS / Game Center mapping is an extra integration on top.                                                 |
| **Announcements / messages**                          | Needs FCM and APNs credentials, audience targeting, scheduling and delivery status. Two external providers and a new delivery subsystem.                                                 |
| **MCP server + scoped service keys**                  | Needs hashed key storage, scopes, last-used tracking, an MCP endpoint and an agent audit log. Bantam exposes no MCP surface today, so this is a new server surface, not an admin screen. |
| **Apple Game Center auth**                            | A second auth provider alongside PGS v2. The auth layer is provider-shaped so the change is contained, but it is a new external dependency and a new consent flow.                       |
| **Cloud-save revisions + diff**                       | Bantam has no save model. This is a whole new store.                                                                                                                                     |

---

## Recommendation

Tier 1 is shipped: the per-player leaderboard view (#3), the economy summary
(#5), the inventory ledger (#6) and the admin audit trail (#7). Two additive
migrations (007 `admin_audit`, 008 the leaderboard player index) and one
append-only table back them. #7 is the one that turns the console from a
viewer into an operable tool.

The one Tier-1 item still open is #4, operator-initiated reward claim — one
endpoint plus a dialog, no migration.

Leave Tier 2 alone until a real game needs it; #9 in particular is a change to
the flag hot path and should not ride along with UI work. Treat Tier 3 as
product decisions, not dashboard work.
