# Bantam Game Services

**Small footprint. Authoritative results.**

Bantam is a single-writer game backend for authenticated, server-validated leaderboards, per-game feature flags, and an optional server-owned economy (wallets, inventory, virtual shop, Google Play IAP). It runs as one non-root container, isolates each title in its own SQLite database, and continuously replicates those databases with Litestream. The framework is game-agnostic: any game dev self-hosts it, drops adapter files into a mounted folder, and ships.

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

The server boots with an empty manifest. To access the admin console, open `http://localhost:3000/admin/register` once to create the inaugural admin (registration closes after the first admin exists). Then visit `/admin/login` for subsequent sessions.

`/admin/` redirects to the console at `/admin/console/` — a React single-page app built from `packages/admin-ui` and served by the same Fastify process. It covers the operational surface: a cross-game overview with a 7-day activity chart, per-game boards, players (with wallet, inventory, purchases and audited currency/item adjustments), runs, feature flags, the economy catalog, the adapter registry, health, and a manifest editor. `⌘K` opens a command palette; the theme follows the system.

The console talks to a JSON API under `/admin/api/`. The session cookie is `HttpOnly` and `SameSite=Strict`, so the browser attaches it to same-origin requests automatically — no token ever reaches JavaScript. Unauthenticated API calls answer `401` with a JSON body. The server-rendered pages remain at `/admin/legacy` as a no-JavaScript fallback.

Per-game **feature flags** live at `/admin/console/games/{id}/flags` (`/admin/games/{id}/flags` in the fallback). Operators create, edit, enable/disable, and delete flags; clients read them from `GET /v1/games/{gameId}/flags` (optional `Bearer`) or via `bantam.getFlags()`. A flag below 100% rollout resolves per signed-in player from `HMAC-SHA256(flagKey + ":" + playerId, ${secretPrefix}_IDENTITY_SALT)`, so the answer is stable across restarts and instances; anonymous callers always see `false` for those. `value` is sent only when the flag resolves on for that caller. Flags take effect on the next client read — no restart. Never put a secret in a flag `value`.

Optional **economy** catalogs live on the game entry in `games.json`. Clients read wallet, inventory, and store prices from `/v1/games/{gameId}/economy/*` or via `bantam.getWallet()` / `getInventory()` / `getStore()`. Purchases send an offer id and a `requestId`, never a price. Google Play IAP tokens go to `POST /economy/iap` for Android Publisher verification. Operators inspect and adjust a player at `/admin/console/games/{id}/players` (`admin_adjustment` by default, or a custom reason) or `/admin/games/{id}/players/{playerId}` in the fallback. Docs: `docs/src/content/docs/economy.md`.

The game page lists boards from every loaded adapter (top 50 per board). The Settings page is a form plus an Advanced JSON panel. If you mount a `games.json` file into the container read-only, the editor shows a banner and disables save; unset `BANTAM_CONFIG_FILE` and let the server manage `/data/games.json` to edit through the UI.

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

## License

Copyright (C) 2026 Gamercury Studio.

The Bantam server — everything in this repository except `packages/sdk` — is licensed under the GNU Affero General Public License, version 3, or (at your option) any later version. The full text is `LICENSE`.

You may use Bantam, modify it, and run it as a service. If you distribute Bantam or a modified version, or if you offer a modified version over a network, you must publish that source under the same license, keep the copyright and license notices, and you receive a patent license from each contributor so they cannot patent the work and then stop others from using the version they received.

`packages/sdk` (`@gamercury/bantam-sdk`) is MIT. See `packages/sdk/LICENSE`. Installing the client in a game does not license the game under the AGPL.
