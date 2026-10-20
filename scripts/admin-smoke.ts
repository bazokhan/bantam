// In-process smoke for the admin dashboard. Boots buildApp with a manifest
// that includes a file-adapter game (echo-demo) and a generic game (demo),
// then exercises every new admin page to confirm 200s and expected content.
// Wired as `npm run admin:smoke`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preloadAdapterDirectory } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import type { LoadedConfig } from "../src/config.js";
import { GenericAdapter } from "../src/adapters/built-in/generic.js";
import { resolveAdminUiRoot } from "../src/admin/spa.js";

const here = dirname(fileURLToPath(import.meta.url));
const adaptersDir = join(here, "..", "test", "fixtures", "adapters");
process.env.BANTAM_ADAPTERS_DIR = adaptersDir;

const secret = "admin-smoke-secret-at-least-32";
const dataDir = mkdtempSync(join(tmpdir(), "bantam-admin-smoke-"));

const configValue: LoadedConfig = {
  environment: "test",
  dataDir,
  allowedOrigins: ["https://example.com"],
  manifestPath: undefined,
  manifestWritable: true,
  games: new Map([
    [
      "demo",
      {
        id: "demo",
        displayName: "Demo",
        adapters: [
          {
            kind: "generic",
            boards: [{ id: "high_score", direction: "higher", period: "all_time" }],
          },
        ],
        secretPrefix: "TEST",
        gracePeriodHours: 24,
        authProvider: "development",
        identitySalt: secret,
        sessionSecret: secret,
        cursorSecret: secret,
      },
    ],
    [
      "echo-demo",
      {
        id: "echo-demo",
        displayName: "Echo",
        adapters: [{ kind: "file", source: "echo-v1.mjs" }],
        secretPrefix: "TEST",
        gracePeriodHours: 24,
        authProvider: "development",
        identitySalt: secret + "echo",
        sessionSecret: secret + "echo",
        cursorSecret: secret + "echo",
      },
    ],
  ]),
};

await preloadAdapterDirectory(adaptersDir);
// Silence the unused-import warning while keeping the import present so
// the adapter contract stays discoverable from the smoke script.
void GenericAdapter;
const app = await buildApp(configValue, { logger: false });

try {
  // Bootstrap admin (first-admin rule: registration is open until the row exists).
  const reg = await app.inject({
    method: "POST",
    url: "/admin/register",
    payload: "username=ops&password=hunter2hunter2&confirm=hunter2hunter2",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (reg.statusCode !== 302) throw new Error(`register failed: ${reg.statusCode} ${reg.body.slice(0, 200)}`);
  const cookie = reg.headers["set-cookie"]!.toString().split(";")[0]!;

  // Seed one player + one run so the leaderboard isn't empty.
  const login = await app.inject({
    method: "POST",
    url: "/v1/games/echo-demo/auth/exchange",
    payload: { authorizationCode: "smoke-admin" },
  });
  const token = (JSON.parse(login.body) as { accessToken: string }).accessToken;
  await app.inject({
    method: "POST",
    url: "/v1/games/echo-demo/runs/echo-v1",
    headers: { authorization: `Bearer ${token}` },
    payload: { runId: "smoke-admin-1", payload: { value: 7 } },
  });

  // Every new admin page must render 200. We assert status only — body
  // assertions live in the unit tests.
  const pages = [
    "/admin/legacy",
    "/admin/games",
    "/admin/games/demo",
    "/admin/games/echo-demo",
    "/admin/games/demo/boards",
    "/admin/games/demo/boards/high_score",
    "/admin/games/echo-demo/boards",
    "/admin/games/echo-demo/boards/echo",
    "/admin/games/demo/runs",
    "/admin/games/demo/players",
    "/admin/adapters",
    "/admin/health",
    "/admin/manifest",
  ];
  const results: Record<string, number> = {};
  for (const path of pages) {
    const res = await app.inject({ method: "GET", url: path, headers: { cookie } });
    if (res.statusCode !== 200)
      throw new Error(`page ${path} returned ${res.statusCode}: ${res.body.slice(0, 200)}`);
    results[path] = res.statusCode;
  }

  // The React console's JSON API. Every route must answer 200 for a
  // session-authenticated operator.
  const apiPaths = [
    "/admin/api/session",
    "/admin/api/overview",
    "/admin/api/games",
    "/admin/api/games/demo",
    "/admin/api/games/demo/boards/high_score",
    "/admin/api/games/echo-demo/players",
    "/admin/api/games/echo-demo/runs",
    "/admin/api/games/demo/flags",
    "/admin/api/games/demo/economy",
    "/admin/api/games/echo-demo/players",
    "/admin/api/health",
    "/admin/api/adapters",
    "/admin/api/adapters/echo-v1/source",
    "/admin/api/manifest",
    "/admin/api/audit",
  ];
  for (const path of apiPaths) {
    const res = await app.inject({ method: "GET", url: path, headers: { cookie } });
    if (res.statusCode !== 200)
      throw new Error(`api ${path} returned ${res.statusCode}: ${res.body.slice(0, 200)}`);
    JSON.parse(res.body);
    results[path] = res.statusCode;
  }

  // The per-player leaderboard view. Needs a real player id, so read it from
  // the players list first.
  const playerList = await app.inject({
    method: "GET",
    url: "/admin/api/games/echo-demo/players",
    headers: { cookie },
  });
  const firstPlayer = (JSON.parse(playerList.body) as { players: { id: string }[] }).players[0];
  if (firstPlayer) {
    const entries = await app.inject({
      method: "GET",
      url: `/admin/api/games/echo-demo/players/${firstPlayer.id}/entries`,
      headers: { cookie },
    });
    if (entries.statusCode !== 200)
      throw new Error(`api player entries returned ${entries.statusCode}: ${entries.body.slice(0, 200)}`);
    JSON.parse(entries.body);
    results["/admin/api/games/:gameId/players/:playerId/entries"] = entries.statusCode;
  }

  // The console shell. It is a build artifact, so an unbuilt checkout gets a
  // 503 explaining how to build it rather than a broken page.
  const consoleRes = await app.inject({ method: "GET", url: "/admin/console/", headers: { cookie } });
  if (resolveAdminUiRoot()) {
    if (consoleRes.statusCode !== 200)
      throw new Error(`console returned ${consoleRes.statusCode}: ${consoleRes.body.slice(0, 200)}`);
    if (!consoleRes.body.includes('<div id="root">'))
      throw new Error("console shell did not return the SPA entry document");
    // The bundle the shell points at must actually be served, and must be
    // cacheable — a shell that references a 404 asset is a broken console.
    const asset = /\/admin\/console\/assets\/[^"]+\.js/.exec(consoleRes.body)?.[0];
    if (!asset) throw new Error("console shell did not reference a JS bundle");
    const assetRes = await app.inject({ method: "GET", url: asset, headers: { cookie } });
    if (assetRes.statusCode !== 200)
      throw new Error(`console asset ${asset} returned ${assetRes.statusCode}`);
    if (!assetRes.headers["cache-control"]?.includes("immutable"))
      throw new Error(
        `console asset ${asset} is not cacheable: ${String(assetRes.headers["cache-control"])}`,
      );
  } else if (consoleRes.statusCode !== 503) {
    throw new Error(`unbuilt console should return 503, got ${consoleRes.statusCode}`);
  }
  results["/admin/console/"] = consoleRes.statusCode;

  // Unauthenticated API calls answer 401 JSON, never a redirect into the
  // login page's HTML.
  const apiBlocked = await app.inject({ method: "GET", url: "/admin/api/overview" });
  if (apiBlocked.statusCode !== 401)
    throw new Error(`unauthenticated /admin/api/overview should 401, got ${apiBlocked.statusCode}`);
  if (!apiBlocked.body.includes("unauthorized"))
    throw new Error(`unauthenticated API body should be JSON, got ${apiBlocked.body.slice(0, 120)}`);

  // Confirm unauthenticated redirects hit /admin/login.
  const blocked = await app.inject({ method: "GET", url: "/admin/" });
  if (blocked.statusCode !== 302)
    throw new Error(`unauthenticated /admin/ should 302, got ${blocked.statusCode}`);
  if (!blocked.headers.location?.startsWith("/admin/login"))
    throw new Error(
      `unauthenticated /admin/ should redirect to /admin/login, got ${blocked.headers.location}`,
    );

  // Confirm public surface is unchanged: the new admin pages do not appear in
  // /openapi.json. /v1/games/:id/leaderboards/:id MUST still be documented.
  const openapi = await app.inject({ method: "GET", url: "/openapi.json" });
  const doc = JSON.parse(openapi.body) as { paths: Record<string, unknown> };
  if (Object.keys(doc.paths).some((p) => p.startsWith("/admin")))
    throw new Error(
      `/openapi.json leaked admin paths: ${Object.keys(doc.paths)
        .filter((p) => p.startsWith("/admin"))
        .join(",")}`,
    );
  if (!doc.paths["/v1/games/{gameId}/leaderboards/{boardId}"])
    throw new Error("public /v1/games/.../leaderboards disappeared from openapi");

  process.stdout.write(`${JSON.stringify({ pages: results, openapiAdminLeaks: 0 })}\n`);
} finally {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
