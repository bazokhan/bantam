---
title: Operations and observability
description: Health, metrics, alerts, releases, recovery, and admin DB.
---

`/healthz` proves the process can answer. `/readyz` opens every configured database, verifies migrations during startup, and performs a query. `/version` reports the service, source revision/build time when supplied, and the list of loaded adapters (deduplicated by id).

Set `BANTAM_METRICS_TOKEN` to enable `/metrics`; otherwise it returns 404. Structured logs are the primary incident trail and remain privacy-safe.

Alert on repeated 5xx responses, readiness failures, disk pressure, container restarts, sustained SQLite busy errors, elevated auth-provider failures, refresh-token reuse, and Litestream lag or replication failure. Do not put request bodies or player evidence into issue trackers.

## Admin dashboard

The admin dashboard at `/admin/` lists games, adapters, and per-game health. It is read-only for inspections, plus a Manifest editor that validates and hot-reloads the manifest. The dashboard is gated by a session cookie issued on login; the first registration creates the only admin. See [Admin dashboard](/admin-dashboard/) and [First deploy](/first-deploy/).

## Migrations

Migrations live in `migrations/`:

- `001_initial.sql` — `players`, `refresh_sessions`, `runs`, `leaderboard_entries`, `rate_limits` (per-game DB)
- `002_admins.sql` — `admins`, `admin_sessions` (server-global DB)
- `003_feature_flags.sql` — `feature_flags` (per-game DB)

Per-game DBs are at `/data/games/<id>/bantam.sqlite`. The admin DB is at `/data/admin.sqlite`. Litestream replication of `/data` covers both.

## Release record

Record the Git commit, image digest, service version, adapter versions, highest migration, configuration revision, backup status, startup measurement, and rollback decision. Verify a real HTTP flow after deployment; container health alone does not validate PGS or object storage.

## Release lanes

Every release must pass these in order. A skipped lane is a blocker (see the project engineering rules). Run them locally before pushing — `npm run verify` chains them.

| Lane                     | Command                                      | Catches                                                    |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------- |
| Format                   | `npm run format:check` (or `npm run format`) | Prettier formatting drift                                  |
| Lint                     | `npm run lint`                               | Unsafe `any` types, unused imports, `await` of non-Promise |
| Typecheck                | `npm run typecheck`                          | TS errors that ESLint misses                               |
| Unit + integration tests | `npm test`                                   | Behavioral regressions                                     |
| Production build         | `npm run build`                              | Build target mismatch                                      |
| OpenAPI drift            | `npm run openapi:check`                      | Spec / implementation mismatch                             |
| Adapter smoke            | `npm run adapters:smoke`                     | File adapter loader end-to-end                             |
| Docs build               | `npm run docs:check`                         | Starlight/Astro compile errors                             |

CI runs the first six; the smoke and docs lanes are local-only unless the workflow is updated.

## Genuine production inputs

Production requires per-game PGS Web client ID/secret (or another single-issuer policy), random identity/session/cursor secrets, S3-compatible endpoint/bucket/region/credentials, final API origin and CORS list, deployment domain/TLS and `/data` volume, and explicit deployment approval. No local fixture substitutes for these inputs.
