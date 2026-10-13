// One-shot seeder for the local demo. Boots buildApp with a manifest that
// declares the generic and file-adapter games, registers an admin, exchanges
// a handful of player sessions, and submits runs to populate leaderboards.
// Run via `npm run demo:seed`.

import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preloadAdapterDirectory } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { GenericAdapter } from "../src/adapters/built-in/generic.js";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const adaptersDir = join(here, "..", "test", "fixtures", "adapters");
process.env.BANTAM_ADAPTERS_DIR = adaptersDir;

const manifestPath = process.env.BANTAM_DEMO_MANIFEST ?? "/tmp/bantam-demo/manifest.json";
const dataDir = process.env.BANTAM_DEMO_DATA ?? "/tmp/bantam-demo/data";
mkdirSync(dataDir, { recursive: true });
process.env.BANTAM_DATA_DIR = dataDir;
process.env.BANTAM_CONFIG_FILE = manifestPath;

// Secrets matching the demo manifest's prefixes.
const secret = "demo-secret-that-is-long-enough-0001";
const echoSecret = "echo-demo-secret-at-least-thirty-two";
process.env.TEST_IDENTITY_SALT = secret;
process.env.TEST_SESSION_SECRET = secret;
process.env.TEST_CURSOR_SECRET = secret;
process.env.TEST_ECHO_IDENTITY_SALT = echoSecret;
process.env.TEST_ECHO_SESSION_SECRET = echoSecret;
process.env.TEST_ECHO_CURSOR_SECRET = echoSecret;

// loadConfig reads BANTAM_CONFIG_FILE + resolves secrets from process.env.
const config = loadConfig(manifestPath);
void GenericAdapter;

// Games come from the loaded config, which already validated the manifest.
const manifestGameIds = [...config.games.keys()];

await preloadAdapterDirectory(adaptersDir);
const app = await buildApp(config, { logger: false });

try {
  // Register the admin user so the operator can log into the dashboard.
  const reg = await app.inject({
    method: "POST",
    url: "/admin/register",
    payload: "username=demoadmin&password=demoadmin123&confirm=demoadmin123",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  if (reg.statusCode !== 302) {
    throw new Error(`register failed: ${reg.statusCode} ${reg.body.slice(0, 200)}`);
  }
  const adminCookie = reg.headers["set-cookie"]!.toString().split(";")[0]!;

  // Seed demo game — five players, varied scores.
  const players = [
    { code: "alice", score: 1200 },
    { code: "bob", score: 850 },
    { code: "carol", score: 1450 },
    { code: "dave", score: 300 },
    { code: "eve", score: 990 },
  ];
  for (const p of players) {
    const login = await app.inject({
      method: "POST",
      url: "/v1/games/demo/auth/exchange",
      payload: { authorizationCode: p.code },
    });
    const token = (JSON.parse(login.body) as { accessToken: string }).accessToken;
    await app.inject({
      method: "POST",
      url: `/v1/games/demo/runs/generic:fastest_finish,high_score`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        runId: `demo-${p.code}-${randomUUID()}`,
        payload: { high_score: p.score, fastest_finish: 60 + (p.score % 90) },
      },
    });
  }

  // Seed echo-demo — three players.
  const echoPlayers = [
    { code: "fiona", value: 7 },
    { code: "george", value: 13 },
    { code: "helen", value: 4 },
  ];
  for (const p of echoPlayers) {
    const login = await app.inject({
      method: "POST",
      url: "/v1/games/echo-demo/auth/exchange",
      payload: { authorizationCode: p.code },
    });
    const token = (JSON.parse(login.body) as { accessToken: string }).accessToken;
    await app.inject({
      method: "POST",
      url: `/v1/games/echo-demo/runs/echo-v1`,
      headers: { authorization: `Bearer ${token}` },
      payload: { runId: `echo-${p.code}-${randomUUID()}`, payload: { value: p.value } },
    });
  }

  // Seed feature flags through the admin write path (the live app is the
  // single SQLite writer). Mixed shapes on purpose: fully rolled out, a
  // string value, a partial rollout, and a disabled flag.
  const seedFlags = [
    "key=daily_challenge&description=Daily+challenge+mode&rolloutPercent=100&enabled=true",
    "key=season_badge&description=Season+badge+in+results&value=s3&rolloutPercent=100&enabled=true",
    "key=experimental_shop&description=Half-rolled-out+experiment&rolloutPercent=50&enabled=true",
    "key=legacy_tutorial&description=Turned+off&rolloutPercent=100",
  ];
  for (const gameId of manifestGameIds) {
    for (const payload of seedFlags) {
      const saved = await app.inject({
        method: "POST",
        url: `/admin/games/${gameId}/flags`,
        payload,
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: adminCookie },
      });
      if (saved.statusCode !== 302) {
        throw new Error(`flag seed failed for ${gameId}: ${saved.statusCode} ${saved.body.slice(0, 200)}`);
      }
    }
  }

  process.stdout.write(
    `${JSON.stringify({ dataDir, adminUsername: "demoadmin", adminPassword: "demoadmin123" })}\n`,
  );
} finally {
  await app.close();
}
