---
title: Your first game in 4 commands
description: From a fresh container to a working leaderboard with one bash command and one browser click.
---

Four steps take you from zero to a real, authoritative leaderboard. No manifest file required at boot. No `BANTAM_ADMIN_TOKEN` to copy. Each step is one commit-sized action.

- A working Docker host.
- The `bantam` image, available on Docker Hub as [`bazokhan/bantam:<tag>`](https://hub.docker.com/r/bazokhan/bantam).
- 64 KiB of free disk per game (SQLite + WAL).

## Step 1 — Start the service

```bash
mkdir bantam-data
docker run -d --name bantam \
  -p 3000:3000 \
  -v "$PWD/bantam-data:/data" \
  bazokhan/bantam:latest
```

Bantam boots with an empty manifest. The container starts, `/healthz` returns `{"status":"ok"}`, and `/readyz` returns `{"status":"ready","games":[]}`. No `games.json` was needed.

## Step 2 — Register the first admin

Open `http://localhost:3000/admin/register` in your browser. Fill in a username and password (8+ characters). The first registered account becomes the inaugural admin; once it exists, registration is closed.

You are now logged in and redirected to `/admin/manifest`, which is currently empty. The session cookie is `HttpOnly`, `SameSite=Strict`, and lasts 30 days.

## Step 3 — Create your first game from the dashboard

Paste this manifest into the Manifest page:

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

Click **Save & reload**. The manifest is written to `/data/games.json` inside your `bantam-data` volume, and the server hot-reloads: `/readyz` now reports `{"status":"ready","games":[{"id":"demo","ready":true}]}`. No container restart required.

Stop the container, set the per-game secrets, and start it again so the demo game can serve real sessions:

```bash
docker stop bantam
docker rm bantam
docker run -d --name bantam \
  -p 3000:3000 \
  -v "$PWD/bantam-data:/data" \
  -e BANTAM_GAME_DEMO_IDENTITY_SALT=replace-with-32-random-bytes \
  -e BANTAM_GAME_DEMO_SESSION_SECRET=replace-with-32-random-bytes \
  -e BANTAM_GAME_DEMO_CURSOR_SECRET=replace-with-32-random-bytes \
  bazokhan/bantam:latest
```

## Step 4 — Submit a score from your game client

```bash
# 1. Get a session token (dev provider — any code works)
TOKEN=$(curl -s -X POST http://localhost:3000/v1/games/demo/auth/exchange \
  -H 'content-type: application/json' \
  -d '{"authorizationCode":"local-player"}' | jq -r .accessToken)

# 2. Submit a run with a high-score payload
curl -X POST http://localhost:3000/v1/games/demo/runs/generic:high_score \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"runId":"run-0001","payload":{"high_score":42}}'

# 3. Read the leaderboard
curl http://localhost:3000/v1/games/demo/leaderboards/high_score \
  -H "Authorization: Bearer $TOKEN"
```

The synthesized adapter `generic:high_score` accepts any object with `high_score: <safe-integer>` and writes the player's best score to the `high_score` board. Multiple submissions from the same player only improve if the new value is strictly higher.

## What you get for free

- **Best-only queue.** Submitting the same `(adapterId, periodKey)` again only sends the higher value.
- **Idempotent retries.** Re-submitting the same `runId` returns the cached response — no duplicate leaderboard entries.
- **Offline-friendly.** Auth cancellation and network failure leave the queue intact; runs flush on next online tick.
- **Backups.** Litestream is wired into the runtime container — your `/data` directory replicates continuously to whatever S3 bucket you pointed at.
- **Hot manifest edits.** Add, remove, or replace games from the admin dashboard at any time. No restart, no outage.

## When to graduate past `generic`

The synthesized adapter accepts only safe integers as values. If your game needs:

- Deterministic historical `periodKey` (e.g. "yesterday's board")
- Tampering rejection (recomputing the score from raw events)
- Multiple values from a single submission

…write a real file adapter — see [Adapter authoring](/adapter-authoring/). It's still one file and ~50 lines for most cases.
