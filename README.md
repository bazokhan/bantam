# Bantam Game Services

**Small footprint. Authoritative results.**

Bantam is a single-writer game backend for authenticated, server-validated leaderboards. It runs as one non-root container, isolates each title in its own SQLite database, and continuously replicates those databases with Litestream.

## Local start

```powershell
Copy-Item .env.demo .env
docker compose up --build
```

The API listens on `http://localhost:3000`. Use the development auth provider only with the committed development manifest; production configuration rejects it.

```powershell
$login = Invoke-RestMethod -Method Post -ContentType application/json `
  -Uri http://localhost:3000/v1/games/example-title/auth/exchange `
  -Body '{"authorizationCode":"demo-player"}'
Invoke-RestMethod -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -Uri 'http://localhost:3000/v1/games/example-title/leaderboards/daily_score?period=2026-09-23'
```

## Verification

```powershell
npm install
npm run verify
npm run test:cross-repo
docker compose build
docker compose up -d
```

Configuration, recovery, deployment, adapter, API, and SDK details live in the sibling `bantam-docs` repository. No production credentials are included here.
