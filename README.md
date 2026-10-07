# Bantam Game Services

**Small footprint. Authoritative results.**

Bantam is a single-writer game backend for authenticated, server-validated leaderboards. It runs as one non-root container, isolates each title in its own SQLite database, and continuously replicates those databases with Litestream. The framework is game-agnostic: any game dev self-hosts it, drops adapter files into a mounted folder, and ships.

## Local start

```powershell
Copy-Item .env.demo .env
docker compose up --build
```

The API listens on `http://localhost:3000`. Use the development auth provider only with the committed development manifest; production configuration rejects it.

```powershell
$login = Invoke-RestMethod -Method Post -ContentType application/json `
  -Uri http://localhost:3000/v1/games/demo/auth/exchange `
  -Body '{"authorizationCode":"demo-player"}'
Invoke-RestMethod -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -Uri 'http://localhost:3000/v1/games/demo/leaderboards/high_score'
```

## Adapter authoring

Two ways to add a game:

1. **Drop a file** — write a `.js`/`.mjs` adapter implementing the `GameAdapterV1` contract, place it in the mounted `/bantam/adapters` folder, reference it from `games.json`:

   ```json
   { "kind": "file", "source": "my-game-v1.js" }
   ```

2. **Generic boards** — for trivial games, declare boards in config; the server synthesizes the adapter at boot:

   ```json
   { "kind": "generic", "boards": [{ "id": "high_score", "direction": "higher", "period": "all_time" }] }
   ```

Restart the container to pick up new adapters. Full contract and authoring guide: see the `docs/` site.

## Admin UI

```bash
BANTAM_ADMIN_TOKEN=<token> docker compose up -d
curl -H "Authorization: Bearer <token>" http://localhost:3000/admin/
```

Read-only: lists games, loaded adapters, per-game health, recent runs (no payload bodies).

## Verification

```powershell
npm install
npm run verify
docker compose build
docker compose up -d
```

Release lanes: format, lint, typecheck, test, build, openapi drift, adapter smoke, container end-to-end, backup/restore. A skipped required lane is a blocker.

Configuration, recovery, deployment, adapter contract, API reference, and SDK details live in the `docs/` site (Astro Starlight, built locally). No production credentials are included here.
