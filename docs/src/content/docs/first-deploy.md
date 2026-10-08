---
title: First deploy
description: Walkthrough for going from a fresh container to a usable admin dashboard and your first game.
---

This page assumes you have just pulled the bantam image and want to bring up a working deployment. It covers the operator workflow end to end without assuming anything about your orchestrator (Coolify, Portainer, plain Docker, Kubernetes).

## Before you start

- A working orchestrator (or a Docker host) with at least one free port mapping for the container.
- A persistent volume (or named volume) mounted at `/data` inside the container. The admin database, your manifest, and per-game SQLite files all live here. Without it, every restart wipes all state.
- Optional: `LITESTREAM_*` and `AWS_*` env vars pointing at a real S3 bucket, if you want continuous backups.

That's the whole prerequisites list. No manifest file is required at boot.

## Step 1 — Start the container

A typical command (adapt to the orchestrator's UI):

```bash
docker run -d --name bantam \
  -p 3000:3000 \
  -v bantam-data:/data \
  --restart unless-stopped \
  bazokhan/bantam:latest
```

The container starts, the entrypoint runs, and node binds on `:3000`. If your orchestrator proxy returns 404 even though the container logs show "Server listening", the proxy is pointing at a different port than the container (commonly `80`). Set the proxy to forward to `3000`, restart the app, and confirm again.

## Step 2 — Confirm health

```bash
curl http://<host>:3000/healthz     # {"status":"ok"}
curl http://<host>:3000/readyz      # {"status":"ready","games":[]}
```

`{"status":"ready","games":[]}` is the success state for a fresh install. The server has booted, the admin database has been initialized, and the manifest is empty. The admin dashboard will guide you through creating your first game.

If `/readyz` returns 503, the container logs will name the failing game (only relevant after you've added games). On a fresh install, 503 means the orchestrator has not actually started the container, or the container is bound to a different port — recheck the proxy and volume mount.

## Step 3 — Register the first admin

Open `http://<host>:3000/admin/register` in a browser. You will see a registration form titled **Create the first admin** with three fields: username, password, and confirm password.

> **Important:** the first time you visit, the URL must be `/admin/register`, not `/admin/login`. Until any admin row exists, the `/admin/login` page renders the same registration form (for convenience) but routes the form action to `/admin/register`. After the first admin exists, `/admin/register` returns 404 and only `/admin/login` accepts credentials.

Fill in a username and a password of at least 8 characters. Submit. The server hashes the password with scrypt (no plain-text storage), creates an `admins` row, issues a session cookie, and redirects you to `/admin/`. The cookie is `HttpOnly`, `SameSite=Strict`, and lasts 30 days.

If the form rejects your submission, the most likely causes are:

- **Username format**: only letters, digits, dot, underscore, dash; up to 64 characters.
- **Password mismatch**: the password and confirm fields must match exactly.
- **Username already taken**: registration only opens when no admin exists. If the form returns 404, an admin was created earlier (check whether you restarted without the persistent volume).

## Step 4 — Create your first game

Once logged in, open `/admin/manifest`. Paste a manifest like:

```json
{
  "environment": "development",
  "games": [
    {
      "id": "demo",
      "displayName": "Demo",
      "adapters": [
        { "kind": "generic", "boards": [{ "id": "high_score", "direction": "higher", "period": "all_time" }] }
      ],
      "secretPrefix": "BANTAM_GAME_DEMO",
      "gracePeriodHours": 24,
      "authProvider": "development"
    }
  ]
}
```

Click **Save & reload**. The server validates the JSON, writes it to `/data/games.json` (or to the file at `$BANTAM_CONFIG_FILE` if you mounted one), opens a new SQLite database for the game at `/data/games/demo/bantam.sqlite`, runs the migration, and synthesizes the `generic` adapter. `/readyz` now reports the new game.

> **Read-only mount:** if you mounted a `games.json` from the host and the admin editor shows a banner saying the manifest is read-only, drop that mount from the container and let the server manage `/data/games.json` directly.

## Step 5 — Set per-game secrets and restart

The `generic` adapter works without per-game secrets, but if you want to actually submit runs and read leaderboards with a signed session, you need to set the three secrets for your game's prefix:

```bash
docker stop bantam
docker rm bantam
docker run -d --name bantam \
  -p 3000:3000 \
  -v bantam-data:/data \
  -e BANTAM_GAME_DEMO_IDENTITY_SALT=replace-with-32-random-bytes \
  -e BANTAM_GAME_DEMO_SESSION_SECRET=replace-with-32-random-bytes \
  -e BANTAM_GAME_DEMO_CURSOR_SECRET=replace-with-32-random-bytes \
  --restart unless-stopped \
  bazokhan/bantam:latest
```

Each secret must be at least 16 characters. Use independent random values per title and per purpose.

## Step 6 — Submit your first score

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/v1/games/demo/auth/exchange \
  -H 'content-type: application/json' \
  -d '{"authorizationCode":"local-player"}' | jq -r .accessToken)

curl -X POST http://localhost:3000/v1/games/demo/runs/generic:high_score \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"runId":"run-0001","payload":{"high_score":42}}'

curl http://localhost:3000/v1/games/demo/leaderboards/high_score \
  -H "Authorization: Bearer $TOKEN"
```

## What survives a restart

When mounted at `/data`, the following survive container restarts:

- `/data/admin.sqlite` — admin accounts and active sessions.
- `/data/games.json` — the manifest (when `BANTAM_CONFIG_FILE` is unset).
- `/data/games/<id>/bantam.sqlite` — per-game database, including all player data and leaderboard entries.
- `/data/litestream.generated.yml` — Litestream replica config.

If you did not mount a persistent volume, all of the above are wiped on every restart.

## What happens on a manual restart while a deploy is pending

Restart does not pull a new image. To update to the latest image, redeploy via the orchestrator (Coolify: top-right **Redeploy** button). After redeploy, the persistent volume is reused, so the admin DB and games survive.

## Recovery recipes

### "I lost my admin password"

The admin DB is `/data/admin.sqlite`. With the container stopped, delete that file. On next start, registration reopens.

### "I want to reset the manifest back to empty"

Stop the container and delete `/data/games.json`. The next boot starts with `games: []`. Per-game SQLite files (`/data/games/<id>/bantam.sqlite`) are kept unless you delete them too.

### "I started a second container and the original admin doesn't exist anymore"

The second container has its own ephemeral `/data` layer unless you mount the same persistent volume. To share state across containers, point both containers at the same volume. Containers behind a load balancer must share the same volume AND only one replica can be active at a time (single-writer SQLite).
