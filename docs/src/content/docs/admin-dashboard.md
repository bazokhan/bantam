---
title: Admin dashboard
description: Session-cookie admin UI for the manifest, feature flags, boards, runs, and player economy.
---

The framework includes a session-cookie admin UI on the same port as the API. It is reachable at `/admin/`, which redirects to the console at `/admin/console/`.

## The console

`/admin/console/` is a React single-page console (built from `packages/admin-ui`, served by the same Fastify process). It covers the same ground as the server-rendered pages, with a persistent sidebar, a game switcher, a command palette (`⌘K` / `Ctrl-K`), and light/dark themes.

The console talks to a JSON API under `/admin/api/`. The session cookie is `HttpOnly` and `SameSite=Strict`, so the browser attaches it to same-origin requests automatically — no token is ever exposed to JavaScript. Unauthenticated API calls return `401` with a JSON body rather than a redirect.

| Screen              | Path                                   |
| ------------------- | -------------------------------------- |
| Overview            | `/admin/console/`                      |
| Games               | `/admin/console/games`                 |
| Game detail         | `/admin/console/games/:gameId`         |
| Leaderboards        | `/admin/console/games/:gameId/boards`  |
| Players             | `/admin/console/games/:gameId/players` |
| Runs                | `/admin/console/games/:gameId/runs`    |
| Feature flags       | `/admin/console/games/:gameId/flags`   |
| Economy             | `/admin/console/games/:gameId/economy` |
| Adapters            | `/admin/console/adapters`              |
| Health              | `/admin/console/health`                |
| Audit trail         | `/admin/console/audit`                 |
| Settings (manifest) | `/admin/console/settings`              |

The console is a build artifact of the image. If it has not been built, `/admin/console/` returns `503` with a short page explaining how to build it, and the server-rendered pages below stay available as a fallback.

## First-run registration

Open `http://<host>:3000/admin/register` once. If the `admins` table is empty, the page renders a registration form. Submitting creates the inaugural admin account and immediately logs you in via session cookie.

Once any admin exists, the registration page is closed and returns 404. Use `/admin/login` from then on. To recover a lost password, rotate `data/admin.sqlite` from a shell on the host.

The first-admin registration gate is the only thing protecting admin access on a fresh deployment, so don't expose port `3000` to the internet until you've created your admin and configured secrets.

## Login

`GET /admin/login` renders a username + password form. `POST /admin/login` accepts the form, verifies the password (scrypt with `N=16384,r=8,p=1`), and on success issues a session cookie.

The session cookie (`bantam_admin`) is:

- `HttpOnly` — not readable by JavaScript.
- `SameSite=Strict` — never sent on cross-origin navigation.
- `Secure` — HTTPS only, except when `BANTAM_ADMIN_COOKIE_SECURE=false` (for local HTTP testing).
- `Path=/admin/` — scoped to admin routes.
- 30-day expiry, rolling via the server's `admin_sessions` table.

Any `/admin/*` request without a valid cookie is redirected to `/admin/login?next=<url>` (for GET) or returns 401 (for POST/PUT/DELETE). Requests under `/admin/api/` always return `401` with a JSON body, including GET, so the console can detect an expired session without following a redirect into the login page's HTML.

## Logout

`POST /admin/logout` revokes the session in the database, clears the cookie, and redirects to `/admin/login`.

## Manifest editor

`GET /admin/manifest` shows a form-based editor for the existing games plus a collapsible **Advanced JSON** panel for the full document. `POST /admin/manifest` validates against the manifest schema and writes to the canonical path:

- If `BANTAM_CONFIG_FILE` is set and the file exists, edits are written there (the same file the server reads at boot).
- Otherwise, edits are written to `${BANTAM_DATA_DIR}/games.json` (default `/data/games.json`).

If the resolved path is read-only (e.g. a `:ro` mount in compose), the editor is disabled and the page shows a banner explaining how to switch to a writable path. Save fails with a clear error pointing at the read-only file.

The form lets you change `environment`, plus `displayName`, `authProvider`, `gracePeriodHours`, `secretPrefix`, and the optional **economy catalog** (currencies, items, offers, rewards, IAP grants) for each existing game. Adding or removing games requires the Advanced JSON path — the form intentionally cannot drop or duplicate a game. Empty currency rows mean the catalog is omitted. Adapter specs stay read-only on the form.

When `environment` is `production`, the `authProvider` select hides the `development` option, and a save that reaches the runtime with `production + development` is rejected by the same boot-rule guard the initial loader enforces. Save fails with a 500 and the on-disk manifest is rolled back to the prior version so a follow-up save can succeed without an already-bad manifest standing in the way.

After a successful save, the server hot-reloads:

- New games open their SQLite file at `/data/games/<id>/bantam.sqlite`, run migrations, and synthesize any `generic` adapters.
- Removed games are closed and their SQLite files left in place on disk (operator decision to delete or restore).
- Unchanged games are left alone.

A successful save redirects to `/admin/manifest?saved=1`.

## Feature flags

`GET /admin/games/:id/flags` lists that game's flags and hosts the create form. Each row shows the key, description, enabled/disabled state, rollout percentage, value, and last update, with **Enable/Disable**, **Edit**, and a confirm-guarded **Delete**.

Flags are per-game and stored in the game's own SQLite file. Operators are the only writers; clients read them from `GET /v1/games/{gameId}/flags`.

| Method | Path                            | Purpose                                         |
| ------ | ------------------------------- | ----------------------------------------------- |
| GET    | `/admin/games/:id/flags`        | List flags + create form.                       |
| GET    | `/admin/games/:id/flags/:key`   | Edit one flag (key is read-only).               |
| POST   | `/admin/games/:id/flags`        | Create or replace a flag by key.                |
| POST   | `/admin/games/:id/flags/:key`   | Save edits to an existing flag.                 |
| POST   | `/admin/games/:id/flags/toggle` | Flip enabled without touching rollout or value. |
| POST   | `/admin/games/:id/flags/delete` | Delete a flag (confirm-guarded).                |

Field rules:

- **key** — `^[a-z0-9][a-z0-9._-]{0,63}$`. Rejected with an error banner otherwise; keys are not auto-corrected.
- **description** — operator-facing, up to 200 characters. Never sent to clients.
- **value** — up to 500 characters, sent to clients only when the flag resolves on for that caller; otherwise the public payload has `value: null`. Configuration only, never a secret.
- **rollout percent** — integer `0`–`100` (required). `100` is on for everyone including signed-out clients. Below `100` resolves per signed-in player via `HMAC-SHA256(flagKey + ":" + playerId, per-game identity salt)`, so a player keeps the same answer across restarts and instances, and buckets cannot be correlated across games.
- **enabled** — the master switch, checked before rollout.
- **cap** — 64 flags per game. Creating a 65th key is rejected; updating an existing key is not.

Every write is gated by the admin session cookie, and each change is logged with the admin identity, game, flag key, and action. A rollout change takes effect on the next client read; no restart or reload is needed.

## Routes

### Console API

All routes below require the session cookie and answer `401` (JSON) without it.

| Method | Path                                              | Purpose                                                                             |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/admin/api/session`                              | Signed-in admin identity and whether first-run registration is open.                |
| POST   | `/admin/api/logout`                               | Revoke the session and clear the cookie.                                            |
| GET    | `/admin/api/overview`                             | KPIs, 7-day activity series, per-game summary, recent score entries.                |
| GET    | `/admin/api/games`                                | Per-game summary (id, name, auth, boards, players, flags, env presence).            |
| GET    | `/admin/api/games/:id`                            | Game detail: grace period, environment, adapters, boards, env keys.                 |
| GET    | `/admin/api/games/:id/boards/:boardId`            | Ranked entries for a board and its available period keys.                           |
| GET    | `/admin/api/games/:id/players`                    | Player table plus the total player count.                                           |
| GET    | `/admin/api/games/:id/players/:playerId`          | Wallet, ledger, inventory ledger, store purchases, IAP state, run count.            |
| GET    | `/admin/api/games/:id/players/:playerId/entries`  | Every board and period the player is ranked on, with their rank on each.            |
| POST   | `/admin/api/games/:id/players/:playerId/currency` | Audited credit/debit for a catalog currency, with a reason.                         |
| POST   | `/admin/api/games/:id/players/:playerId/item`     | Audited grant/remove of a catalog item, with a reason.                              |
| DELETE | `/admin/api/games/:id/players/:playerId`          | Delete a single player; reuses the same `deletePlayer` path the public API exposes. |
| GET    | `/admin/api/games/:id/runs`                       | Recent score entries with board, value and player.                                  |
| GET    | `/admin/api/games/:id/flags`                      | Feature flags with their targeting summary.                                         |
| PUT    | `/admin/api/games/:id/flags/:key`                 | Create or replace a flag by key.                                                    |
| POST   | `/admin/api/games/:id/flags/:key/toggle`          | Flip enabled without touching rollout or value.                                     |
| DELETE | `/admin/api/games/:id/flags/:key`                 | Delete a flag (confirm-guarded).                                                    |
| GET    | `/admin/api/games/:id/economy`                    | Catalog plus the live summary: supply, holders and ledger velocity.                 |
| GET    | `/admin/api/health`                               | Per-game db readiness, adapter coverage, env completeness, CORS origins.            |
| GET    | `/admin/api/adapters`                             | Loaded adapters and the games that reference them.                                  |
| GET    | `/admin/api/audit`                                | The operator action trail. Supports `limit`, `action` and `gameId` filters.         |
| GET    | `/admin/api/manifest`                             | The manifest document and the current environment.                                  |
| PUT    | `/admin/api/manifest`                             | Save + reload runtimes; rolls back on reload failure.                               |

### Audit trail

Every write the console performs appends one row to `admin_audit` in the admin database: the acting admin, the action, the game, the target, a small JSON detail object, and the timestamp. The trail is append-only — nothing in the server updates or deletes an audit row — and it lives in the server-level admin database, so it survives a game database being reset.

| Action            | Recorded when                            |
| ----------------- | ---------------------------------------- |
| `flag.write`      | A flag is created or edited.             |
| `flag.toggle`     | A flag is enabled or disabled.           |
| `flag.delete`     | A flag is removed.                       |
| `player.delete`   | A player is deleted.                     |
| `currency.credit` | An operator credits a player's currency. |
| `currency.debit`  | An operator debits a player's currency.  |
| `item.grant`      | An operator grants an item.              |
| `item.remove`     | An operator removes an item.             |
| `manifest.save`   | The manifest is saved.                   |

The detail object never carries credentials, tokens, raw provider ids, IP addresses or headers — it holds only the values the operator typed, such as the amount, the currency id and the reason.

### Server-rendered pages

These remain available as a no-JavaScript fallback. `/admin/` redirects to the console; `/admin/legacy` is the old overview page.

| Method | Path                                          | Purpose                                                                                                 |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/legacy`                               | Legacy overview: counts (games, players, runs today) and a one-line per-game summary.                   |
| GET    | `/admin/login`                                | Login form (or auto-redirects to `/admin/console/` if already authenticated).                           |
| POST   | `/admin/login`                                | Submit credentials, issue session cookie.                                                               |
| GET    | `/admin/register`                             | First-admin registration form. 404 once any admin exists.                                               |
| POST   | `/admin/register`                             | Create inaugural admin. 404 once any admin exists.                                                      |
| POST   | `/admin/logout`                               | Revoke session, clear cookie, redirect to login.                                                        |
| GET    | `/admin/games`                                | Per-game table (id, display name, auth badge, adapter count, player count, db readiness).               |
| GET    | `/admin/games/:id`                            | Auth/grace, env key presence (never values), boards, last run time, and a read-only economy catalog.    |
| GET    | `/admin/games/:id/boards`                     | Boards list across every loaded adapter.                                                                |
| GET    | `/admin/games/:id/boards/:boardId`            | Top 50 for that board (period = `all_time` or today UTC).                                               |
| GET    | `/admin/games/:id/runs`                       | Last 20 runs (runId, adapterId, createdAt, payloadHash only).                                           |
| GET    | `/admin/games/:id/flags`                      | Feature flags list + create form.                                                                       |
| GET    | `/admin/games/:id/players`                    | Player table (truncated id, provider, created) + a confirm-POST delete form.                            |
| GET    | `/admin/games/:id/players/:playerId`          | Wallet, ledger, inventory, store purchases, IAP state (no tokens), and catalog-backed adjustment forms. |
| POST   | `/admin/games/:id/players/:playerId/currency` | Audited credit/debit (`admin_adjustment`) for a catalog currency.                                       |
| POST   | `/admin/games/:id/players/:playerId/item`     | Audited grant/remove of a catalog item.                                                                 |
| POST   | `/admin/games/:id/players/delete`             | Delete a single player; reuses the same `deletePlayer` path the public API exposes.                     |
| GET    | `/admin/adapters`                             | Loaded adapters + which games reference them.                                                           |
| GET    | `/admin/health`                               | Per-game db readiness, adapter coverage, env completeness, **read-only CORS origin list**.              |
| GET    | `/admin/manifest`                             | Manifest editor (form + Advanced JSON).                                                                 |
| POST   | `/admin/manifest`                             | Save + reload runtimes; rolls back on reload failure.                                                   |

## Trust

The admin UI is server-global (one `data/admin.sqlite` per deployment, litestream-replicated as part of the `/data` volume). All write actions are gated by the session cookie; the cookie is HttpOnly + SameSite=Strict; CSRF is mitigated by the cookie's same-origin requirement and the absence of any third-party JS on these pages.

The console is first-party JavaScript served from the same origin. It is a static bundle with no third-party script, no analytics, and no remote font or image fetch. It never receives a secret: env vars are reported as present/missing only, session tokens stay in the `HttpOnly` cookie, and every value it renders comes from a server-derived JSON response. Leaderboard values are derived by the versioned server adapter inside the run transaction — the console has no write path for scores.

The OpenAPI spec at `/openapi.json` is public, but every `/admin/*` route is hidden from it (the swagger plugin sees `schema.hide = true` on these routes via an `onRoute` hook in `app.ts`). The admin UI is the only privileged surface; SDK generators and external clients only see `/v1/*`.
