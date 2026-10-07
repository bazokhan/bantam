---
title: Docker and Coolify deployment
description: Deploy one non-root Bantam writer with persistent storage.
---

> **Image:** [`bazokhan/bantam`](https://hub.docker.com/r/bazokhan/bantam) on Docker Hub. **Docs site:** [bantam.trugraph.io](https://bantam.trugraph.io).

## Container contract

- Listen on port `3000`.
- Mount one persistent volume at `/data` — stores the admin DB (`admin.sqlite`), the per-game SQLite files, Litestream state, and (when `BANTAM_CONFIG_FILE` is unset) the writable manifest at `/data/games.json`.
- Optionally mount a read-only `games.json` at `BANTAM_CONFIG_FILE` (default `/etc/bantam/games.json`) for static manifests. When the file exists and is readable, it wins over `/data/games.json`.
- Keep the root filesystem read-only and provide an ephemeral `/tmp` tmpfs.
- Route health checks to `/readyz`; `/healthz` is liveness only.
- Run exactly one application replica for a given set of database files.

## Coolify

Create an application from the bantam image (`bazokhan/bantam:latest`), port `3000`, health path `/readyz`. Add a persistent storage mount at `/data`. Configure the final HTTPS API domain at the reverse proxy and leave SQLite, Litestream/S3, and the admin UI behind authentication.

For your per-game secrets, add the `${PREFIX}_IDENTITY_SALT`, `${PREFIX}_SESSION_SECRET`, `${PREFIX}_CURSOR_SECRET`, plus (for `pgs-v2`) `${PREFIX}_PGS_CLIENT_ID` / `${PREFIX}_PGS_CLIENT_SECRET` as runtime env vars. Add Litestream's bucket, endpoint, region, and credentials as runtime secrets too. Never add secrets as Docker build arguments.

The server boots without a manifest. Open `https://<your-domain>/admin/register` once to create the inaugural admin, then visit `/admin/manifest` to add games via the dashboard. Subsequent runs only need login.

Deploy the API, confirm `/healthz`, `/readyz`, and `/version`, then exercise a real authenticated request before pointing a release client at the domain. A green health check is not proof that PGS or backup credentials work.

## Rollback

Application rollback may use Coolify's previous immutable image only when its migration support includes the current schema. Bantam refuses a database newer than the running binary. Do not rewrite Git history or restore a database merely to roll back application code.

If you need to roll back the schema itself, set `BANTAM_RESTORE_IF_MISSING=true` plus `BANTAM_ONLY_GAME=<id>` to have the entrypoint pull a Litestream backup for that one game. This will not recover a missing admin DB or missing manifest — back those up separately.