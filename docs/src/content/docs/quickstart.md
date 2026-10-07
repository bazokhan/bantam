---
title: Your first game in 4 commands
description: From a fresh directory to a working leaderboard with one Bash command and one JSON file.
---

The four commands below get you from zero to a real, authoritative leaderboard for a real game. Each step is one commit-sized action. Nothing in this page is required by Bantam itself; the framework doesn't care how you got here as long as your game code talks to `/v1/games/<gameId>/runs/<adapterId>` with a Bearer token.

- A working Docker host with Compose.
- The `bantam` image, available on Docker Hub as [`bazokhan/bantam:<tag>`](https://hub.docker.com/r/bazokhan/bantam).
- 64 KiB of free disk per game (SQLite + WAL).

## Step 1 — Start the service

```bash
mkdir MyGame/.adapters MyGame/data
cat > MyGame/games.json <<'EOF'
{
  "environment": "development",
  "games": [
    {
      "id": "demo",
      "displayName": "Demo",
      "adapters": [
        { "kind": "generic", "boards": [
          { "id": "high_score", "direction": "higher", "period": "all_time" }
        ] }
      ],
      "secretPrefix": "BANTAM_GAME_DEMO",
      "gracePeriodHours": 24,
      "authProvider": "development"
    }
  ]
}
EOF
cat > MyGame/.env <<'EOF'
BANTAM_GAME_DEMO_IDENTITY_SALT=demo-only-32-byte-random-please-rotate
BANTAM_GAME_DEMO_SESSION_SECRET=demo-only-32-byte-random-please-rotate
BANTAM_GAME_DEMO_CURSOR_SECRET=demo-only-32-byte-random-please-rotate
EOF
docker run -d --name bantam \
  -p 3000:3000 \
  --env-file MyGame/.env \
  -v MyGame/data:/data \
  -v MyGame/games.json:/etc/bantam/games.json:ro \
  -v MyGame/.adapters:/bantam/adapters \
  bazokhan/bantam:latest
```

Bantam listens on `:3000`. The development auth provider accepts any code matching `^[A-Za-z0-9._~-]{3,128}$`. Production deployments must switch to `authProvider: "pgs-v2"` — see [Manifest and PGS v2](/configuration/).

## Step 2 — Verify the service is ready

```bash
curl --fail http://localhost:3000/readyz
```

Expect `{"status":"ready","games":[{"id":"demo","ready":true}]}`. A non-200 response means a config error — see [Troubleshooting](/troubleshooting/).

## Step 3 — Submit a score

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

## Step 4 — Wire your game client

The [TypeScript SDK](/reference/) wraps the auth + submit + retry + queue dance:

```ts
import { BantamClient, BrowserStorage } from "@gamercury/bantam-sdk";

const bantam = new BantamClient({
  baseUrl: "https://your-bantam.example.com",
  gameId: "demo",
  storage: new BrowserStorage(), // or any { get, set, remove }
});

// On game start, sign the player in (or cancel — offline play still works).
await bantam.optionalLogin(() => getProviderServerAuthCode());

// After every run the player finishes, queue it. Bantam flushes on its own.
await bantam.queueBest({
  gameId: "demo",
  adapterId: "generic:high_score",
  runId: `run-${Date.now()}`,
  payload: { high_score: finalScore },
  candidates: [{ boardId: "high_score", periodKey: "all_time", value: finalScore }],
});
```

`queueBest` stores the run in `localStorage` and calls `flushQueue` automatically. The SDK retries on `500`/`429`, drops the run on `400` (server rejected it), and removes the run from storage once the server accepts it.

## What you get for free

- **Best-only queue.** Submitting the same `(adapterId, periodKey)` again only sends the higher value.
- **Idempotent retries.** Re-submitting the same `runId` returns the cached response — no duplicate leaderboard entries.
- **Offline-friendly.** Auth cancellation and network failure leave the queue intact; runs flush on next online tick.
- **Backups.** Litestream is wired into the runtime container — your `/data` directory replicates continuously to whatever S3 bucket you pointed at.
- **Restore.** `docker run --rm -v bantam-restore:/data --entrypoint bantam-entrypoint bazokhan/bantam --restore-if-missing demo` pulls a fresh database from the bucket.

## When to graduate past `generic`

The synthesized adapter accepts only safe integers as values. If your game needs:

- Deterministic historical `periodKey` (e.g. "yesterday's board")
- Tampering rejection (recomputing the score from raw events)
- Multiple values from a single submission

…write a real file adapter — see [Adapter authoring](/adapter-authoring/). It's still one file and ~50 lines for most cases.
