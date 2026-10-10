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

The server boots with an empty manifest. To access the admin dashboard, open `http://localhost:3000/admin/register` once to create the inaugural admin (registration closes after the first admin exists). Then visit `/admin/login` for subsequent sessions.

The dashboard lists games, loaded adapters, per-game health, and recent runs (no payload bodies), plus a Manifest editor that validates JSON against the schema and hot-reloads the runtime — no container restart required for adding, removing, or replacing games.

Today the game page only renders a top-10 for **generic** adapters, so file-adapter titles (boards, players, auth flips) look empty even when SQLite has data. The Manifest editor is a JSON textarea. Make that UI useful without secrets: `ADMIN_DASHBOARD_PLAN.md`.

If you mount a `games.json` file into the container read-only, the editor shows a banner and disables save; unset `BANTAM_CONFIG_FILE` and let the server manage `/data/games.json` to edit through the UI.

## Verification

```powershell
npm install
npm run verify
docker compose build
docker compose up -d
```

Release lanes: format, lint, typecheck, test, build, openapi drift, adapter smoke, container end-to-end, backup/restore. A skipped required lane is a blocker.

Configuration, recovery, deployment, adapter contract, API reference, and SDK details live in the `docs/` site (Astro Starlight, built locally). No production credentials are included here.

Games install the client from npm: `npm install @gamercury/bantam-sdk`. Maintainers publish by pushing tag `sdk-v<semver>` (GitHub Actions trusted publishing, no `NPM_TOKEN`) or locally with `npm run sdk:publish`. Do not publish the server package. See https://bantam.trugraph.io/sdk/ (source: `docs/src/content/docs/sdk.md`).

## Agent skill

Reusable instructions for wiring any game (auth, adapters, `BantamClient`, secrets as paths only):

```
npx skills add bazokhan/bantam --skill bantam
```

Canonical files: `.agents/skills/bantam/SKILL.md` and `.agents/skills/bantam/reference.md`. Local fallback: `npx skills add D:/Gamercury/bantam --skill bantam`. List discoverable skills with `npx skills add D:/Gamercury/bantam -l`. Do not put passwords or tokens in the skill.
