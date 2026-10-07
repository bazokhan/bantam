// In-process smoke for the file-adapter loader. Boots buildApp with
// BANTAM_ADAPTERS_DIR pointing at ./test/fixtures/adapters/, which contains
// echo-v1.mjs. Submits a run, asserts the value lands on the leaderboard.
// Wired as `npm run adapters:smoke` into `verify`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preloadAdapterDirectory } from "../src/adapters/registry.js";
import { buildApp } from "../src/app.js";
import type { LoadedConfig } from "../src/config.js";
import { randomUUID } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const adaptersDir = join(here, "..", "test", "fixtures", "adapters");
process.env.BANTAM_ADAPTERS_DIR = adaptersDir;

const secret = "adapters-smoke-secret-at-least-32";
const dataDir = mkdtempSync(join(tmpdir(), "bantam-adapters-smoke-"));

const config: LoadedConfig = {
  environment: "test",
  dataDir,
  allowedOrigins: [],
  games: new Map([
    [
      "echo-demo",
      {
        id: "echo-demo",
        displayName: "echo",
        adapters: [{ kind: "file", source: "echo-v1.mjs" }],
        secretPrefix: "TEST",
        gracePeriodHours: 24,
        authProvider: "development",
        identitySalt: secret,
        sessionSecret: secret,
        cursorSecret: secret,
      },
    ],
  ]),
};

await preloadAdapterDirectory(adaptersDir);
const app = await buildApp(config, { logger: false });

try {
  const login = await app.inject({
    method: "POST",
    url: "/v1/games/echo-demo/auth/exchange",
    payload: { authorizationCode: "smoke-adapter-loader" },
  });
  if (login.statusCode !== 200) throw new Error(`login failed: ${login.statusCode} ${login.body}`);
  const token = (JSON.parse(login.body) as { accessToken: string }).accessToken;

  const runId = `run-${randomUUID()}`;
  const submit = await app.inject({
    method: "POST",
    url: "/v1/games/echo-demo/runs/echo-v1",
    headers: { authorization: `Bearer ${token}` },
    payload: { runId, payload: { value: 42 } },
  });
  if (submit.statusCode !== 200) throw new Error(`submit failed: ${submit.statusCode} ${submit.body}`);
  const body = JSON.parse(submit.body) as { improvements: { boardId: string; value: number }[] };
  if (!body.improvements.some((i) => i.boardId === "echo" && i.value === 42))
    throw new Error(`expected improvement {echo, 42}, got: ${JSON.stringify(body)}`);

  const board = await app.inject({
    method: "GET",
    url: "/v1/games/echo-demo/leaderboards/echo?limit=5",
    headers: { authorization: `Bearer ${token}` },
  });
  if (board.statusCode !== 200) throw new Error(`board failed: ${board.statusCode} ${board.body}`);
  const entries = (JSON.parse(board.body) as { entries: { value: number }[] }).entries;
  if (!entries.some((e) => e.value === 42))
    throw new Error(`leaderboard missing 42: ${JSON.stringify(entries)}`);

  process.stdout.write(`${JSON.stringify({ status: "ok", value: 42 })}\n`);
} finally {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
