---
title: Troubleshooting
description: Diagnose configuration, authentication, SQLite, replication, and deployment failures.
---

## Readiness is 503

Inspect the first startup error. Common causes are missing per-game secrets, an unknown adapter referenced in the manifest, a modified migration checksum, a database newer than the binary, or an unwritable `/data` mount. Do not bypass migration validation.

## Adapter file not loaded

The runtime scans `BANTAM_ADAPTERS_DIR` at boot. If `games.json` references a file spec and the file is absent or its `default` export does not satisfy the contract, startup aborts with `500 adapter-invalid`. Confirm the filename, the export shape, and that the container's volume is mounted read-only.

## PGS exchange returns 401

Confirm the Android client requested the code for the Game server's Web client ID, the code was sent only once and promptly, the PGS project is published for the tester, and the server client secret matches that ID. Do not log the code to diagnose it.

## Submissions return 400

Use the machine-readable error code. For the `generic` adapter, check that every required board is present, values are safe integers, and no unknown keys appear. For custom file adapters, the adapter's own contract applies.

## SQLite is busy

Confirm there is only one Bantam replica and no external process writes the live file. Inspect long requests and transaction duration. Never copy a live database without its WAL state; use Litestream or the documented stopped-writer procedure.

## Restore finds nothing

Check the exact deployment/game replica prefix, bucket endpoint, region, path-style mode, and credentials. `backup-status` must show the configured database. A successful MinIO test proves the workflow, not the production bucket configuration.

## IAP submit returns 503 `iap-not-configured`

The game catalog lists a Google Play product but `${secretPrefix}_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is missing. Set the service-account JSON in the deployment secret store (never commit it), restart the container, and retry. Presence is shown on the console's game page at `/admin/console/games/{id}` as a required env key; the value is never rendered. See [Game economy](/economy/#google-play-iap).

## Shop purchase returns 409 `insufficient-funds`

The catalog price is authoritative. Credit the wallet through a catalog reward, IAP, or an admin adjustment — the client cannot send a balance. Repeating the same `requestId` after a successful purchase returns the original outcome (`replayed: true`), not a second grant.

## Feature flags always resolve `false`

Check the master switch, rollout percent, and whether the client sent a Bearer token. Flags below 100% are `false` for anonymous callers. `isEnabled` also returns its fallback when the request fails. Never put a secret in `value`. See [Feature flags](/flags/).

## The SDK queue never flushes

Check network availability, optional sign-in result, session refresh, adapter id, and expiry. Authentication cancellation is intentionally non-fatal and leaves the queue intact.

## Container exits immediately on first boot

Walk through these in order:

1. **Missing `/etc/bantam/games.json` is no longer fatal.** The server boots with an empty manifest (`games: []`) and a stderr warning. If you see the container restarting, the issue is something else.
2. **Litestream config requires an S3 backend.** The entrypoint script runs `generate-litestream-config` which throws if `LITESTREAM_REPLICA_URL` is not set to an `s3://` URL. Either set the env vars (point to a real bucket) or upgrade to a bantam image that handles the empty case by writing an empty `dbs:` config and running node without the litestream wrapper.
3. **Entrypoint uses `set -eu`.** Any failing step aborts the whole entrypoint. Container restart loops usually point at the first failing step.
4. **Container port mismatch with the orchestrator.** The orchestrator's proxy must forward to the container's actual listen port (`3000`, not `80`). If you see 404 from the orchestrator proxy while logs show requests are returning 200 from inside the container, the proxy is pointing at the wrong port.

## Reverse proxy returns 404 or 502

- **404 from the proxy with no upstream error**: the proxy is pointing at a closed port inside the container. Common when an orchestrator config defaults `ports_exposes` to `80` while the app listens on `3000`. Update the project's port mapping to match the container's actual listen port (e.g. `3000:3000`).
- **502 Bad Gateway**: the proxy is configured but the upstream container is unreachable, exiting, or failing its readiness check. Inspect container logs directly. If logs show `Server listening at http://0.0.0.0:3000` and the Dockerfile `HEALTHCHECK` returning 200, the app is healthy — the proxy needs to be reloaded (restart the app via the orchestrator UI) to pick up the latest port mapping.

## Orchestrator deploy shows `running:unhealthy`

Two distinct failure modes with different fixes:

- **Docker healthcheck failing** (`/readyz` returning 503 or non-200): the app is up but a game database is not. Look in container logs for the offending gameId, fix the missing per-game secrets or the SQLite file permissions, and restart.
- **Orchestrator's own healthcheck failing**: the orchestrator's healthcheck may be hitting an unrelated endpoint. Set the orchestrator healthcheck path to `/readyz` and disable it temporarily while you bring the container back up.

## Volume not mounted — state wiped on every restart

If you didn't configure a persistent volume at `/data`, the admin DB (`/data/admin.sqlite`), the manifest (`/data/games.json`), and all per-game SQLite files live in the container's ephemeral layer. Every restart wipes them and reopens first-admin registration.

Fix: add a persistent volume mount at `/data`. For named volumes the data survives container restarts but not host migrations. For host bind-mounts the data survives both but is tied to the host path.

## Lost admin password / need to re-register

The admin DB is `/data/admin.sqlite`. With the service stopped, delete that file (or the whole `/data/admin.sqlite` table inside it via SQLite). The next visit to `/admin/register` reopens the first-admin registration flow.

## "Incorrect username or password" on the first registration attempt

You clicked through `/admin/register` (the registration page rendered because no admin exists) but the form action targets the wrong endpoint. The fix shipped: when no admins exist, the `/admin/login` page now renders a registration form that POSTs to `/admin/register`. If you see this error on a freshly deployed instance, upgrade to an image that includes the first-admin registration fix, then visit `/admin/register` directly and submit the form there.

## CI workflow fails locally but the same command worked before

Walk these in order:

1. **YAML parse error**: the workflow name and the raw `.github/workflows/ci.yml` end up being the file path instead of `name: CI`. Common causes: a step name containing `:` (YAML treats `:` as a mapping separator), CRLF line endings from Windows checkouts, or tab indentation. Use `-` or rewrite without `:`. Run `npx -y actionlint` locally to catch.
2. **Step pins to a non-existent SHA**: e.g. `actions/setup-node@<placeholder>`. The CI runner cannot resolve the SHA and reports "Unable to resolve action". Use `@v4` (major-version tags) or real SHAs from the action's tagged releases.
3. **`secrets.*` referenced in a job-level `if:`**: the `secrets` context is not available at job-level. Move the check to a step-level `if: ${{ secrets.X != '' }}`, or assume the step runs and let the action fail with a clear error if the secret is missing.
4. **Prettier fails on a clean working tree**: the runner may install a different prettier version than local. Reformat and commit. Add an `npm ci` step in the workflow to lock the toolchain.

## Docs site (Vercel) returns 404

- **Wrong root directory**: the Vercel project must use `docs/` as the root, not the repo root. Configure via the Vercel dashboard or `PATCH /v9/projects/{id}` body `{"rootDirectory": "docs"}`.
- **`astro check` fails with module-not-found errors for server-only packages** (e.g. `fastify`, `better-sqlite3`): the docs workspace is inheriting the repo's `tsconfig.json` which has `include: ["src/**/*.ts", ...]`. Add a `docs/tsconfig.json` that extends `astro/tsconfigs/strict` and explicitly excludes the server-side directories.
- **Vercel project has SSO enabled** for production deployments: the deployment URL returns 302 → vercel.com SSO. For public docs, `PATCH /v9/projects/{id}` body `{"ssoProtection": null}`.
- **Vercel created a duplicate `docs/` project** when you ran `vercel deploy --prod docs/`: the deploy created a new project named after the local directory. `vercel rm docs` deletes it. Re-link `vercel link` to the correct project so future deploys target it.

## "OpenAPI snapshot is stale" after adding an endpoint

`npm run openapi:generate` rewrites `openapi/bantam.openapi.json`. Commit the regenerated snapshot. Don't bypass `openapi:check` — it's the only signal that the contract on the deployed artifact matches the snapshot.

## Release workflow says "Skipped" for the publish job

The release job runs on push to `main` and on git tags `v*`. If the trigger is missing, check `ci.yml`:

- The job's `if:` predicate usually reads `github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v'))`.
- A pull request from `main` does NOT trigger this — it has to be a merge commit or a direct push.
- A merge commit via "Squash and merge" on GitHub counts as a push to `main` and does trigger this job. A "Rebase and merge" adds as a merge commit; same outcome.

## Coolify / Portainer / generic orchestrator port mismatch

This is the single most common "the deploy succeeded but nothing works" failure. The container listens on a specific port (`3000` for bantam), and the orchestrator's reverse proxy must forward to that exact port. Most orchestrators default `ports_exposes` to `80` (Caddy's default port) when the container declares `EXPOSE 3000`. The fix is to set `ports_exposes` and `ports_mappings` to the container's actual listen port (`3000`), then restart the app so the proxy reloads its config. After the restart, the deployment URL should serve the app instead of a proxy error page.
