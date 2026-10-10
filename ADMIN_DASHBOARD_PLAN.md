# Admin dashboard plan

The live admin UI at `https://bantam-api.trugraph.io/admin/` is a login wall plus a JSON textarea. Operators cannot see players, pick boards, or flip `authProvider` without editing `games.json` by hand. That is a product gap, not missing data: Moon Gravity is registered, `pgs-v2` is live, and `stars-m1` scores exist in SQLite.

Do not put secrets, session cookies, or raw provider ids in this plan or in the future UI.

## Why it looks empty today

`GET /admin/games/:gameId` only renders a top-10 if the game’s manifest adapter is `kind: "generic"`. File adapters (`kind: "file"`, e.g. `moon-gravity-v1.mjs`) load boards at runtime, but the page ignores `runtime.adapters` and prints **No boards**. Runs exist under `/admin/games/:id/runs` (hash only). The Manifest page is a raw JSON blob (`max-width: 28rem` textarea), so flipping auth is a copy-paste operation.

Existing, keep: cookie session, first-admin register-then-lock, HTML templates with `escapeHtml`, hot-reload via `POST /admin/manifest`, no payload bodies in run lists.

## Goals

An operator who can log in should, without JSON:

1. See each game’s `authProvider`, adapter id/version, board list, player count, last run time, and whether required env keys exist (boolean only).
2. Open a board and see the current page (rank, display name, value) — including **file** adapters.
3. List players (truncated id, display name, provider, created) and delete one with a confirm (same `deletePlayer` path as `DELETE /v1/games/{id}/me`).
4. Change `authProvider`, `gracePeriodHours`, `displayName`, and host `environment` with a form that round-trips the full manifest (merge; never drop other games).
5. Stay game-agnostic. No Moon Gravity-only routes. Boards and adapters come from the loaded runtime.

Out of scope: ads, IAP, analytics, Play Console, Coolify env writes, showing secret values, unredacted run payloads, full Play Games player ids in logs.

## Phases

### P0 — Show what is already loaded (smallest useful dashboard)

- Game list: id, display name, auth badge (`pgs-v2` / `development`), adapter count, player count, db ready.
- Game page: kv for auth, grace, secretPrefix **name** (not values), env key presence: `${prefix}_IDENTITY_SALT` / `_SESSION_SECRET` / `_CURSOR_SECRET`, and PGS id/secret **only as present/missing** when auth is `pgs-v2`.
- Boards: iterate `runtime.adapters` values’ `boards[]` (file + generic). Each board is a link.
- Board page: `db.list(board, periodKey, 0, 50)` with period `all_time` or today’s UTC date for `daily`. Empty state: “No scores yet”, not “No boards”.
- Overview: counts (games, players, runs today) plus `/readyz`-equivalent badges.

Add `GameDatabase.listPlayers` / `countPlayers` (no new columns). Truncate ids in HTML (first 8 chars). Never print env values.

### P1 — Players and erasure

- `/admin/games/:gameId/players`: table from `listPlayers`. Confirm-POST delete → `deletePlayer`.
- Do not show refresh tokens. Provider column is `development` | `pgs-v2` only.
- Audit line: admin username + player id truncated + timestamp in server log **without** provider subject.

### P2 — Settings forms (replace the JSON blob as the default)

Keep the JSON textarea behind “Advanced JSON”. Default Manifest page:

- Host: `environment` select (`development` | `test` | `production`) with a warning that production **rejects** development auth at boot.
- Per game: displayName, authProvider select, gracePeriodHours, adapter source (readonly if file). Add game / remove game.
- Save still `POST /admin/manifest` with a merged, schema-validated document (`ManifestStore.save` + `reloadRuntimes`). On reload 500 (missing PGS env), keep the on-disk manifest and show the error — same as today.
- Widen `form.bantam` for the editor (drop `max-width: 28rem` on the manifest form).

### P3 — Operator hygiene

- Health page: per-game adapter loaded vs declared, db `ready()`, PGS env completeness.
- Read-only CORS: show `BANTAM_ALLOWED_ORIGINS` split, not editable until a later phase (changing it needs a process restart).
- Docs site page that matches this UI so `https://bantam.trugraph.io` is not the only place that explains `/admin`.

## Constraints

- Stay server-rendered HTML in `src/admin/`. No SPA, no client secrets in JS.
- Cookie `bantam_admin`, Path `/admin/`, HttpOnly, SameSite=Strict. Do not weaken that for “AJAX”.
- `npm run verify` must cover new admin routes (happy path + CSRF/session missing + schema reject).
- Production + `development` auth remains a boot error. The form must not offer a save that the schema allows but boot will throw, or it must surface that error before save.

## Done when

An operator can open `/admin/`, click Moon Gravity (or any file-adapter game), see `stars-m1` (or that game’s boards), see signed-in players, flip `authProvider` with a dropdown, and delete a test player — without pasting JSON and without seeing secrets.
