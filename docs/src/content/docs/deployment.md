---
title: Docker and Coolify deployment
description: Deploy one non-root Bantam writer with persistent storage.
---

> **Image:** [`bazokhan/bantam`](https://hub.docker.com/r/bazokhan/bantam) on Docker Hub. **Docs site:** [bantam.trugraph.io](https://bantam.trugraph.io).

## Container contract

- Listen on port `3000`.
- Mount one persistent volume at `/data`.
- Mount the game manifest read-only at `/etc/bantam/games.json`.
- Keep the root filesystem read-only and provide an ephemeral `/tmp` tmpfs.
- Route health checks to `/readyz`; `/healthz` is liveness only.
- Run exactly one application replica for a given set of database files.

## Coolify

Create an application from the Bantam repository using `/Dockerfile`, port `3000`, and health path `/readyz`. Add a persistent storage mount at `/data`. Configure the final HTTPS API domain at the reverse proxy and leave SQLite, MinIO/S3, and any administrative endpoint private.

Add the production manifest as a file secret, then add every secret referenced by its per-game `secretPrefix`. Add Litestream’s bucket, endpoint, region, and credentials as runtime secrets. Never add secrets as Docker build arguments.

Deploy the API, confirm `/healthz`, `/readyz`, and `/version`, then exercise a real authenticated request before pointing a release client at the domain. A green health check is not proof that PGS or backup credentials work.

## Rollback

Application rollback may use Coolify’s previous immutable image only when its migration support includes the current schema. Bantam refuses a database newer than the running binary. Do not rewrite Git history or restore a database merely to roll back application code.
