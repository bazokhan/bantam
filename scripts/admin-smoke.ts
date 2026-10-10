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
    "/admin/",
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
