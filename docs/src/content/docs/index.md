---
title: Bantam — Authoritative game backend. One container.
description: Leaderboards, feature flags, and a server-owned economy in one Docker container. Drop an adapter, mount a folder, ship.
template: splash
hero:
  tagline: Leaderboards, flags, and economy. One container. One JSON file.
  actions:
    - text: Your first game in 4 commands
      link: /quickstart/
      icon: right-arrow
      variant: primary
    - text: Read the docs
      link: /adapters/
      icon: open-book
---

<div class="hero-band">
<div style="display:flex;align-items:center;gap:2rem;flex-wrap:wrap;margin:1rem 0 2rem;">
  <svg width="160" height="160" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" style="image-rendering:pixelated;flex:0 0 auto;">
    <!-- Generic pixel alien mascot: NOT copyrighted. 16x16 grid, each cell = one rect. -->
    <g fill="#ff2d95">
      <rect x="3" y="2" width="1" height="1"/>
      <rect x="4" y="1" width="1" height="1"/>
      <rect x="11" y="1" width="1" height="1"/>
      <rect x="12" y="2" width="1" height="1"/>
      <rect x="2" y="3" width="1" height="1"/>
      <rect x="13" y="3" width="1" height="1"/>
    </g>
    <g fill="#00f0ff">
      <rect x="3" y="3" width="10" height="1"/>
      <rect x="2" y="4" width="12" height="1"/>
      <rect x="2" y="5" width="12" height="1"/>
      <rect x="2" y="6" width="12" height="1"/>
      <rect x="2" y="7" width="12" height="1"/>
    </g>
    <g fill="#ffd60a">
      <rect x="5" y="5" width="2" height="2"/>
      <rect x="9" y="5" width="2" height="2"/>
    </g>
    <g fill="#0a0214">
      <rect x="5" y="5" width="1" height="2"/>
      <rect x="6" y="5" width="1" height="1"/>
      <rect x="9" y="5" width="1" height="2"/>
      <rect x="10" y="5" width="1" height="1"/>
    </g>
    <g fill="#ff2d95">
      <rect x="3" y="8" width="1" height="1"/>
      <rect x="5" y="8" width="1" height="1"/>
      <rect x="7" y="8" width="1" height="1"/>
      <rect x="8" y="8" width="1" height="1"/>
      <rect x="10" y="8" width="1" height="1"/>
      <rect x="12" y="8" width="1" height="1"/>
      <rect x="2" y="9" width="1" height="1"/>
      <rect x="4" y="9" width="1" height="1"/>
      <rect x="5" y="9" width="1" height="1"/>
      <rect x="6" y="9" width="1" height="1"/>
      <rect x="9" y="9" width="1" height="1"/>
      <rect x="10" y="9" width="1" height="1"/>
      <rect x="11" y="9" width="1" height="1"/>
      <rect x="13" y="9" width="1" height="1"/>
      <rect x="2" y="10" width="1" height="1"/>
      <rect x="13" y="10" width="1" height="1"/>
      <rect x="2" y="11" width="1" height="1"/>
      <rect x="4" y="11" width="1" height="1"/>
      <rect x="5" y="11" width="1" height="1"/>
      <rect x="10" y="11" width="1" height="1"/>
      <rect x="11" y="11" width="1" height="1"/>
      <rect x="13" y="11" width="1" height="1"/>
      <rect x="3" y="12" width="1" height="1"/>
      <rect x="12" y="12" width="1" height="1"/>
      <rect x="4" y="13" width="1" height="1"/>
      <rect x="11" y="13" width="1" height="1"/>
    </g>
  </svg>
  <div style="flex:1;min-width:240px;">
    <p style="font-size:1.4rem;color:var(--neon-cyan);text-shadow:0 0 0.5rem rgba(0,240,255,0.5);margin:0;">
      <strong>Skip the server engineering.</strong>
      Bantam is a single Docker container that owns identity, ranks, feature flags, wallets, and recovery — so your game sends evidence and reads server-derived state. No DB schema. No migration plan. No auth library. No replica math.
    </p>
  </div>
</div>

## What ships in the container

<div class="grid">
  <div class="grid-card">
    <h3>Authoritative leaderboards</h3>
    <p>Players submit evidence. A versioned adapter derives the score inside the run transaction. Page, me, around-me, daily and all-time boards. See <a href="/leaderboards/">Leaderboards</a>.</p>
  </div>
  <div class="grid-card">
    <h3>Feature flags</h3>
    <p>Per-game flags written in the admin UI, resolved server-side. Full rollout or deterministic per-player buckets. Clients only read. See <a href="/flags/">Feature flags</a>.</p>
  </div>
  <div class="grid-card">
    <h3>Game economy</h3>
    <p>Optional catalog in <code>games.json</code>: wallets, inventory, virtual shop, claimable rewards, Google Play IAP verification. Clients never send a price. See <a href="/economy/">Game economy</a>.</p>
  </div>
  <div class="grid-card">
    <h3>Player auth</h3>
    <p>Play Games Services v2 or a development provider. Per-game HMAC pseudonyms, rotating sessions, refresh families. One config line. See <a href="/configuration/">Manifest and PGS v2</a>.</p>
  </div>
  <div class="grid-card">
    <h3>Admin dashboard</h3>
    <p>Session-cookie UI on the same port. Manifest hot-reload, flags, boards, runs, player economy adjustments. First registration creates the only admin. See <a href="/admin-dashboard/">Admin dashboard</a>.</p>
  </div>
  <div class="grid-card">
    <h3>Self-host backups</h3>
    <p>One non-root container, SQLite WAL, Litestream to S3-compatible storage. You own the data, the keys, and the restore. See <a href="/durability/">SQLite and backups</a>.</p>
  </div>
</div>

## How it is built

<div class="grid">
  <div class="grid-card">
    <h3>One container</h3>
    <p>Fastify, SQLite, Litestream. The whole thing runs as one non-root container. SQLite WAL means single-writer per game, no distributed locks, no surprises.</p>
  </div>
  <div class="grid-card">
    <h3>Game-agnostic by default</h3>
    <p>The framework ships zero game-specific code. Drop a <code>.mjs</code> adapter file into a mounted folder, or skip code entirely and declare boards in JSON. Economy catalogs are optional JSON on the same game entry.</p>
  </div>
  <div class="grid-card">
    <h3>Server-side authority</h3>
    <p>Players submit evidence — a run payload, a flag read, an offer id, or a store token. The server only writes what an adapter or catalog derives. Tampering, replays, and fabricated scores or prices are caught at the door.</p>
  </div>
  <div class="grid-card">
    <h3>Typed client</h3>
    <p>Games install <code>@gamercury/bantam-sdk</code>. Login, queued run submit, leaderboards, flags, wallet, shop, IAP, and player deletion. See <a href="/sdk/">SDK on npm</a>.</p>
  </div>
</div>

<div class="first-game">

## Your first game — 4 commands, no code required

You're 60 seconds from a leaderboard. The "demo" game below is a real config that ships with the image. It accepts `{ "high_score": <number> }` and ranks players. Flags and economy attach to the same game after this.

### 1. Run the container

```bash
docker run -d --name bantam \
  -p 3000:3000 \
  -v bantam-data:/data \
  -v ./my-game:/bantam/adapters \
  -v ./games.json:/etc/bantam/games.json:ro \
  -e BANTAM_GAME_DEMO_IDENTITY_SALT=$(openssl rand -hex 32) \
  -e BANTAM_GAME_DEMO_SESSION_SECRET=$(openssl rand -hex 32) \
  -e BANTAM_GAME_DEMO_CURSOR_SECRET=$(openssl rand -hex 32) \
  bazokhan/bantam:latest
```

### 2. Declare your game

`./games.json`:

```json
{
  "environment": "production",
  "games": [
    {
      "id": "my-game",
      "displayName": "My Game",
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

### 3. Submit a score from your game

```bash
curl -X POST http://localhost:3000/v1/games/my-game/runs/generic:high_score \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{"runId":"run-0001","payload":{"high_score":42}}'
```

### 4. Read the leaderboard

```bash
curl http://localhost:3000/v1/games/my-game/leaderboards/high_score \
  -H "Authorization: Bearer <access-token>"
```

**Done.** You have a real, authoritative, server-validated leaderboard for a real game. Zero database tables touched by hand.

### Then add the rest

Same container, same game id:

- **Flags** — create them at `/admin/games/my-game/flags`. Clients call `GET /v1/games/my-game/flags` or `bantam.getFlags()`. [Feature flags](/flags/).
- **Economy** — add an `economy` catalog to the same `games.json` entry. Clients call `getWallet` / `getStore` / `purchaseItem`. [Game economy](/economy/).
- **Play auth** — switch `authProvider` to `pgs-v2` and set the PGS env keys. [Manifest and PGS v2](/configuration/).
- **Admin** — register once at `/admin/register`, then edit the manifest in place. [Admin dashboard](/admin-dashboard/).

</div>

## What's NOT in your way

<div class="grid">
  <div class="grid-card">
    <h3>No SQL to write</h3>
    <p>SQLite migrations are checksummed and applied automatically on first boot. Your game never sees a row.</p>
  </div>
  <div class="grid-card">
    <h3>No auth boilerplate</h3>
    <p>Drop in <code>authProvider: "pgs-v2"</code> and you get Google Play Games Services v2 server auth codes &rarr; per-game HMAC pseudonyms in one config line.</p>
  </div>
  <div class="grid-card">
    <h3>No ops math</h3>
    <p>Litestream replication to S3-compatible storage runs out of the box. <code>npm run ops -- restore demo</code> brings a game back from a fresh bucket.</p>
  </div>
  <div class="grid-card">
    <h3>No proprietary lock-in</h3>
    <p>The OpenAPI spec, SDK source, and adapter contract are all open. Move off when you outgrow it.</p>
  </div>
</div>

<div class="mascots">
  <figure class="mascot">
    <svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <g fill="#00f0ff">
        <rect x="4" y="2" width="8" height="1"/>
        <rect x="3" y="3" width="10" height="1"/>
        <rect x="2" y="4" width="12" height="1"/>
        <rect x="2" y="5" width="12" height="1"/>
        <rect x="2" y="6" width="12" height="1"/>
        <rect x="2" y="7" width="12" height="1"/>
        <rect x="2" y="8" width="12" height="1"/>
      </g>
      <g fill="#0a0214">
        <rect x="5" y="4" width="2" height="2"/>
        <rect x="9" y="4" width="2" height="2"/>
      </g>
      <g fill="#ff2d95">
        <rect x="3" y="9" width="1" height="1"/>
        <rect x="6" y="9" width="1" height="1"/>
        <rect x="9" y="9" width="1" height="1"/>
        <rect x="12" y="9" width="1" height="1"/>
        <rect x="2" y="10" width="1" height="1"/>
        <rect x="13" y="10" width="1" height="1"/>
        <rect x="2" y="11" width="1" height="1"/>
        <rect x="3" y="11" width="1" height="1"/>
        <rect x="12" y="11" width="1" height="1"/>
        <rect x="13" y="11" width="1" height="1"/>
      </g>
    </svg>
    <figcaption>BLIP<br/>8-bit mascot</figcaption>
  </figure>
  <figure class="mascot">
    <svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <g fill="#ffd60a">
        <rect x="6" y="2" width="4" height="1"/>
        <rect x="4" y="3" width="8" height="1"/>
        <rect x="3" y="4" width="10" height="1"/>
        <rect x="2" y="5" width="12" height="1"/>
        <rect x="2" y="6" width="12" height="1"/>
        <rect x="2" y="7" width="12" height="1"/>
        <rect x="2" y="8" width="12" height="1"/>
        <rect x="2" y="9" width="12" height="1"/>
        <rect x="2" y="10" width="12" height="1"/>
        <rect x="3" y="11" width="10" height="1"/>
        <rect x="4" y="12" width="8" height="1"/>
      </g>
      <g fill="#0a0214">
        <rect x="5" y="5" width="2" height="2"/>
        <rect x="9" y="5" width="2" height="2"/>
      </g>
      <g fill="#39ff14">
        <rect x="7" y="9" width="2" height="1"/>
        <rect x="6" y="10" width="4" height="1"/>
      </g>
    </svg>
    <figcaption>BEEP<br/>generica</figcaption>
  </figure>
  <figure class="mascot">
    <svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <g fill="#8b5cf6">
        <rect x="2" y="3" width="4" height="4"/>
        <rect x="2" y="9" width="4" height="4"/>
      </g>
      <g fill="#ff2d95">
        <rect x="6" y="3" width="4" height="4"/>
        <rect x="10" y="9" width="4" height="4"/>
      </g>
      <g fill="#00f0ff">
        <rect x="10" y="3" width="4" height="4"/>
        <rect x="6" y="9" width="4" height="4"/>
      </g>
      <g fill="#ffd60a">
        <rect x="6" y="7" width="4" height="2"/>
      </g>
    </svg>
    <figcaption>BOOP<br/>shape co.</figcaption>
  </figure>
  <figure class="mascot">
    <svg viewBox="0 0 16 16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <g fill="#39ff14">
        <rect x="4" y="2" width="8" height="2"/>
        <rect x="3" y="4" width="10" height="2"/>
        <rect x="2" y="6" width="12" height="4"/>
      </g>
      <g fill="#0a0214">
        <rect x="5" y="6" width="6" height="1"/>
        <rect x="6" y="7" width="4" height="2"/>
      </g>
      <g fill="#ff2d95">
        <rect x="7" y="6" width="2" height="1"/>
      </g>
    </svg>
    <figcaption>BONK<br/>tile shape</figcaption>
  </figure>
</div>

## Why "Bantam"?

Bantam is a small, scrappy chicken. Bantam is also a small, scrappy game backend. The container is small, the dependencies are small, the integration footprint is small. It does the things a game needs — ranks, flags, wallets, recovery — and skips the rest.

<div class="agentic">

## For AI agents and automation

Bantam is structured so an agent can wire a game end-to-end without reading prose.

**Surface area** (machine-readable):

- OpenAPI 3.0.3 spec at runtime: `GET /openapi.json`
- Adapter contract: `GameAdapterV1` in the server (file adapters in the game repo, not npm)
- Client SDK (public npm): `@gamercury/bantam-sdk` (`BantamClient`) — `npm install @gamercury/bantam-sdk`
- This site's typed reference: see [API and SDK](/reference/)

**Action shapes** (one JSON file per surface):

- `games.json` schema: TypeBox-validated, see [Manifest and PGS v2](/configuration/)
- Optional `economy` catalog on a game entry: currencies, items, offers, rewards, IAP products — see [Game economy](/economy/)
- `RunBody.payload`: `Record<string, unknown>`, opaque by design — adapters define their own payload contract
- Per-game env vars: `${secretPrefix}_IDENTITY_SALT|SESSION_SECRET|CURSOR_SECRET`, plus optional `PGS_CLIENT_ID|SECRET` and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`

**Capabilities** (what Bantam does and does NOT do):

- ✓ authenticates players, persists sessions, refreshes them
- ✓ validates run submissions against a server-side adapter contract
- ✓ persists leaderboard entries per `(board_id, period_key, player_id)`
- ✓ serves paginated leaderboards, player's rank, around-me
- ✓ serves per-game feature flags resolved server-side, with deterministic per-player rollout
- ✓ optional economy: integer wallets, inventory, catalog-priced shop, claimable rewards, Google Play IAP fulfillment
- ✓ continuous backup to S3-compatible storage
- ✗ does not validate the player's gameplay events (your adapter does)
- ✗ does not require any external service, identity provider, or database engine
- ✓ ships a session-cookie admin dashboard: first registration creates the admin, dashboard edits the manifest in-place with hot reload, and operators write flags and audited economy adjustments

**Sandbox expectations**:

- The framework writes only to `/data/games/<gameId>/bantam.sqlite`.
- The framework reads only from `/etc/bantam/games.json` and `/bantam/adapters/`.
- Outbound network calls are Litestream replication, the configured auth provider, and — only when a game catalog lists Google Play IAP products — the Android Publisher API.

</div>
