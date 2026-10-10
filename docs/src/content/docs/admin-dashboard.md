---
title: Admin dashboard
description: Session-cookie admin UI for inspecting games, adapters, runs, and editing the manifest.
---

The framework includes a session-cookie admin UI on the same port as the API. It is reachable at `/admin/`.

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

Any `/admin/*` request without a valid cookie is redirected to `/admin/login?next=<url>` (for GET) or returns 401 (for POST/PUT/DELETE).

## Logout

`POST /admin/logout` revokes the session in the database, clears the cookie, and redirects to `/admin/login`.

## Manifest editor

`GET /admin/manifest` shows a form-based editor for the existing games plus a collapsible **Advanced JSON** panel for the full document. `POST /admin/manifest` validates against the manifest schema and writes to the canonical path:

- If `BANTAM_CONFIG_FILE` is set and the file exists, edits are written there (the same file the server reads at boot).
- Otherwise, edits are written to `${BANTAM_DATA_DIR}/games.json` (default `/data/games.json`).

If the resolved path is read-only (e.g. a `:ro` mount in compose), the editor is disabled and the page shows a banner explaining how to switch to a writable path. Save fails with a clear error pointing at the read-only file.

The form lets you change `environment`, plus `displayName`, `authProvider`, `gracePeriodHours`, and `secretPrefix` for each existing game. Adding or removing games requires the Advanced JSON path — the form intentionally cannot drop or duplicate a game.

When `environment` is `production`, the `authProvider` select hides the `development` option, and a save that reaches the runtime with `production + development` is rejected by the same boot-rule guard the initial loader enforces. Save fails with a 500 and the on-disk manifest is rolled back to the prior version so a follow-up save can succeed without an already-bad manifest standing in the way.

After a successful save, the server hot-reloads:

- New games open their SQLite file at `/data/games/<id>/bantam.sqlite`, run migrations, and synthesize any `generic` adapters.
- Removed games are closed and their SQLite files left in place on disk (operator decision to delete or restore).
- Unchanged games are left alone.

A successful save redirects to `/admin/manifest?saved=1`.

## Routes

| Method | Path                               | Purpose                                                                                                                     |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/`                          | Overview: counts (games, players, runs today) and a one-line per-game summary.                                              |
| GET    | `/admin/login`                     | Login form (or auto-redirects to `/admin/` if already authenticated).                                                       |
| POST   | `/admin/login`                     | Submit credentials, issue session cookie.                                                                                   |
| GET    | `/admin/register`                  | First-admin registration form. 404 once any admin exists.                                                                   |
| POST   | `/admin/register`                  | Create inaugural admin. 404 once any admin exists.                                                                          |
| POST   | `/admin/logout`                    | Revoke session, clear cookie, redirect to login.                                                                            |
| GET    | `/admin/games`                     | Per-game table (id, display name, auth badge, adapter count, player count, db readiness).                                   |
| GET    | `/admin/games/:id`                 | Auth/grace/secretPrefix, **required env keys** (present/missing only, never values), boards (every adapter), last run time. |
| GET    | `/admin/games/:id/boards`          | Boards list across every loaded adapter.                                                                                    |
| GET    | `/admin/games/:id/boards/:boardId` | Top 50 for that board (period = `all_time` or today UTC).                                                                   |
| GET    | `/admin/games/:id/runs`            | Last 20 runs (runId, adapterId, createdAt, payloadHash only).                                                               |
| GET    | `/admin/games/:id/players`         | Player table (truncated id, provider, created) + a confirm-POST delete form.                                                |
| POST   | `/admin/games/:id/players/delete`  | Delete a single player; reuses the same `deletePlayer` path the public API exposes.                                         |
| GET    | `/admin/adapters`                  | Loaded adapters + which games reference them.                                                                               |
| GET    | `/admin/health`                    | Per-game db readiness, adapter coverage, env completeness, **read-only CORS origin list**.                                  |
| GET    | `/admin/manifest`                  | Manifest editor (form + Advanced JSON).                                                                                     |
| POST   | `/admin/manifest`                  | Save + reload runtimes; rolls back on reload failure.                                                                       |

## Trust

The admin UI is server-global (one `data/admin.sqlite` per deployment, litestream-replicated as part of the `/data` volume). All write actions are gated by the session cookie; the cookie is HttpOnly + SameSite=Strict; CSRF is mitigated by the cookie's same-origin requirement and the absence of any third-party JS on these pages.

The OpenAPI spec at `/openapi.json` is public, but every `/admin/*` route is hidden from it (the swagger plugin sees `schema.hide = true` on these routes via an `onRoute` hook in `app.ts`). The admin UI is the only privileged surface; SDK generators and external clients only see `/v1/*`.
