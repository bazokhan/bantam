---
title: Operations and observability
description: Health, metrics, alerts, releases, and recovery evidence.
---

`/healthz` proves the process can answer. `/readyz` opens every configured database, verifies migrations during startup, and performs a query. `/version` reports the service, source revision/build time when supplied, and the list of loaded adapters (deduplicated by id).

Set `BANTAM_METRICS_TOKEN` to enable `/metrics`; otherwise it returns 404. Set `BANTAM_ADMIN_TOKEN` to enable the `/admin/*` UI; otherwise those routes return 404. Metrics are aggregate and use bounded route/status labels. Structured logs are the primary incident trail and remain privacy-safe.

Alert on repeated 5xx responses, readiness failures, disk pressure, container restarts, sustained SQLite busy errors, elevated auth-provider failures, refresh-token reuse, and Litestream lag or replication failure. Do not put request bodies or player evidence into issue trackers.

## Admin dashboard

The admin dashboard at `/admin/` lists games, adapters, and per-game health. It is read-only and token-gated. See [Admin dashboard](/admin-dashboard/).

## Release record

Record the Git commit, image digest, service version, adapter versions, highest migration, configuration revision, backup status, startup measurement, and rollback decision. Verify a real HTTP flow after deployment; container health alone does not validate PGS or object storage.

### v0.1.0 — 2026-10-07

- Git commit: see `git log` on `main` of <https://github.com/bazokhan/bantam>.
- Image: [`bazokhan/bantam:latest`](https://hub.docker.com/r/bazokhan/bantam) (also `bazokhan/bantam:sha-<short>`).
- Service version: `0.1.0` (`@gamercury/bantam` package version).
- Adapter versions: built-in `generic` only (file adapters can be mounted at `/bantam/adapters`).
- Highest migration: `001_initial.sql`.
- Documentation: <https://bantam.trugraph.io>.
- Verified end-to-end: `verify` CI lane passes (format + lint + typecheck + unit + build + openapi + adapter smoke + container smoke + Litestream restore integrity). Real PGS and a final API domain are not claimed by this entry.

## Genuine production inputs

Production requires per-game PGS Web client ID/secret (or another single-issuer policy), random identity/session/cursor secrets, S3-compatible endpoint/bucket/region/credentials, final API origin and CORS list, deployment domain/TLS and `/data` volume, and explicit deployment approval. No local fixture substitutes for these inputs.
