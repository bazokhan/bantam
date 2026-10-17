import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildApp } from "../src/app.js";
import type { AdapterSpec, RuntimeGame } from "../src/types.js";
import { issueSession, rotateSession, verifyAccess } from "../src/auth/sessions.js";
import type { LoadedConfig } from "../src/config.js";
import { GameDatabase } from "../src/db/game-database.js";
import { loadConfig } from "../src/config.js";
import { AdminDatabase } from "../src/db/admin-database.js";
import { decodeCursor, encodeCursor } from "../src/services/cursor.js";
import { derivePlayerId } from "../src/util/crypto.js";
import { sanitizeDisplayName } from "../src/util/display-name.js";
import { BantamError } from "../src/errors.js";
import { GenericAdapter } from "../src/adapters/built-in/generic.js";
import {
  FLAG_MAX,
  isValidFlagKey,
  parseRolloutPercent,
  resolveFlags,
} from "../src/services/feature-flags.js";
import type { FeatureFlagRow } from "../src/types.js";
import { BantamClient } from "../packages/sdk/src/index.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function temp(): string {
  const value = mkdtempSync(join(tmpdir(), "bantam-test-"));
  roots.push(value);
  return value;
}
const secret = "test-secret-that-is-long-enough-000001";
function errorCode(action: () => unknown): string {
  try {
    action();
    return "none";
  } catch (error) {
    return error instanceof BantamError ? error.code : "unknown";
  }
}
function genericAdapter(): AdapterSpec {
  return {
    kind: "generic",
    boards: [
      { id: "high_score", direction: "higher", period: "all_time" },
      { id: "fastest_finish", direction: "lower", period: "all_time", completedOnly: true },
    ],
  };
}
function game(id = "demo"): RuntimeGame {
  return {
    id,
    displayName: id,
    adapters: [genericAdapter()],
    secretPrefix: "TEST",
    gracePeriodHours: 24,
    authProvider: "development",
    identitySalt: secret + id,
    sessionSecret: secret + id,
    cursorSecret: secret + id,
  };
}
function config(dataDir = temp(), games = [game()]): LoadedConfig {
  return {
    environment: "test",
    dataDir,
    allowedOrigins: [],
    games: new Map(games.map((value) => [value.id, value])),
    manifestPath: undefined,
    manifestWritable: true,
  };
}

describe("security primitives", () => {
  it("derives per-game pseudonyms and sanitizes names", () => {
    expect(derivePlayerId("pgs-v2", "raw-player", "salt-a")).not.toBe(
      derivePlayerId("pgs-v2", "raw-player", "salt-b"),
    );
    expect(sanitizeDisplayName(" ‮  Alice\u0000   Player  ")).toBe("Alice Player");
    expect([...sanitizeDisplayName("😀".repeat(30))]).toHaveLength(24);
  });
  it("signs and rejects altered cursors", () => {
    const cursor = encodeCursor(42, secret);
    expect(decodeCursor(cursor, secret)).toBe(42);
    expect(() => decodeCursor(`${cursor}x`, secret)).toThrow("Invalid");
  });
});

describe("generic adapter", () => {
  const adapter = new GenericAdapter([{ id: "score", direction: "higher", period: "all_time" }]);
  it("derives a value from a payload key matching its board id", () => {
    const result = adapter.validateAndDerive({ score: 42 }, { nowMs: 0, gracePeriodHours: 0 });
    expect(result.values).toEqual([{ boardId: "score", periodKey: "all_time", value: 42 }]);
  });
  it("derives a daily periodKey as today UTC", () => {
    const daily = new GenericAdapter([{ id: "today", direction: "higher", period: "daily" }]);
    const result = daily.validateAndDerive(
      { today: 7 },
      { nowMs: Date.UTC(2026, 0, 5), gracePeriodHours: 0 },
    );
    expect(result.values[0]?.periodKey).toBe("2026-01-05");
  });
  it("rejects unknown payload keys", () => {
    expect(() => adapter.validateAndDerive({ score: 1, junk: 2 }, { nowMs: 0, gracePeriodHours: 0 })).toThrow(
      BantamError,
    );
    expect(
      errorCode(() => adapter.validateAndDerive({ score: 1, junk: 2 }, { nowMs: 0, gracePeriodHours: 0 })),
    ).toBe("unknown-field");
  });
  it("rejects non-integer values", () => {
    expect(() => adapter.validateAndDerive({ score: 1.5 }, { nowMs: 0, gracePeriodHours: 0 })).toThrow(
      BantamError,
    );
    expect(() => adapter.validateAndDerive({ score: Number.NaN }, { nowMs: 0, gracePeriodHours: 0 })).toThrow(
      BantamError,
    );
    expect(() => adapter.validateAndDerive({ score: "x" }, { nowMs: 0, gracePeriodHours: 0 })).toThrow(
      BantamError,
    );
  });
});

describe("SQLite durability and leaderboard semantics", () => {
  it("applies migrations, preserves ties, bests, and idempotency", () => {
    const root = temp();
    const db = new GameDatabase(join(root, "game.sqlite"), join(process.cwd(), "migrations"));
    const now = 1_000;
    db.upsertPlayer("a", "dev", "A", now);
    db.upsertPlayer("b", "dev", "B", now);
    const board = { id: "score", direction: "higher" as const, period: "all_time" as const };
    for (const playerId of ["a", "b"])
      db.submitRun({
        adapterId: "test",
        playerId,
        runId: `run-${playerId}-0000`,
        payloadHash: "same",
        values: [{ boardId: "score", periodKey: "all_time", value: 10 }],
        boards: [board],
        response: { accepted: true },
        now,
      });
    expect(db.list(board, "all_time", 0, 10).map((entry) => entry.rank)).toEqual([1, 1]);
    const replay = db.submitRun({
      adapterId: "test",
      playerId: "a",
      runId: "run-a-0000",
      payloadHash: "same",
      values: [],
      boards: [board],
      response: {},
      now,
    });
    expect(replay.replayed).toBe(true);
    expect(() =>
      db.submitRun({
        adapterId: "test",
        playerId: "a",
        runId: "run-a-0000",
        payloadHash: "changed",
        values: [],
        boards: [board],
        response: {},
        now,
      }),
    ).toThrow("reused");
    expect(db.integrity()).toEqual(["ok"]);
    db.close();
  });
  it("detects a changed migration checksum", () => {
    const root = temp();
    const migrations = join(root, "migrations");
    cpSync(join(process.cwd(), "migrations"), migrations, { recursive: true });
    const path = join(root, "game.sqlite");
    new GameDatabase(path, migrations).close();
    writeFileSync(
      join(migrations, "001_initial.sql"),
      `${readFileSync(join(migrations, "001_initial.sql"), "utf8")}\n-- changed\n`,
    );
    expect(() => new GameDatabase(path, migrations)).toThrow("modified");
  });
  it("upgrades an existing game database with 003_feature_flags", () => {
    const root = temp();
    const migrations = join(root, "migrations");
    cpSync(join(process.cwd(), "migrations"), migrations, { recursive: true });
    rmSync(join(migrations, "003_feature_flags.sql"));
    rmSync(join(migrations, "004_economy.sql"));
    rmSync(join(migrations, "005_economy_shop.sql"));
    const path = join(root, "game.sqlite");
    new GameDatabase(path, migrations).close();
    const before = new Database(path);
    expect(before.prepare("SELECT count(*) FROM schema_migrations").pluck().get()).toBe(2);
    before.close();
    cpSync(
      join(process.cwd(), "migrations", "003_feature_flags.sql"),
      join(migrations, "003_feature_flags.sql"),
    );
    const db = new GameDatabase(path, migrations);
    expect(db.listFlags()).toEqual([]);
    db.close();
  });
  it("rolls back a failed migration and refuses newer or destructive schemas", () => {
    const root = temp();
    const migrations = join(root, "migrations");
    cpSync(join(process.cwd(), "migrations"), migrations, { recursive: true });
    // Remove any non-001 production migrations so this test owns the migration
    // list (avoid colliding with later versions when production adds them).
    for (const file of readdirSync(migrations)) {
      if (/^\d{3}_.+\.sql$/.test(file) && !file.startsWith("001_")) {
        rmSync(join(migrations, file));
      }
    }
    const path = join(root, "game.sqlite");
    new GameDatabase(path, migrations).close();

    writeFileSync(
      join(migrations, "002_broken.sql"),
      "CREATE TABLE transient_value(id INTEGER) STRICT; THIS IS NOT SQL;\n",
    );
    expect(() => new GameDatabase(path, migrations)).toThrow();
    const inspection = new Database(path);
    expect(
      inspection.prepare("SELECT count(*) FROM sqlite_master WHERE name='transient_value'").pluck().get(),
    ).toBe(0);
    expect(inspection.prepare("SELECT count(*) FROM schema_migrations").pluck().get()).toBe(1);
    inspection.close();

    writeFileSync(join(migrations, "002_broken.sql"), "DROP TABLE players;\n");
    expect(() => new GameDatabase(path, migrations)).toThrow("destructive");

    rmSync(join(migrations, "002_broken.sql"));
    const newer = new Database(path);
    newer
      .prepare(
        "INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(99,'future','future',?)",
      )
      .run(Date.now());
    newer.close();
    expect(() => new GameDatabase(path, migrations)).toThrow("newer");
  });
  it("rotates refresh tokens and revokes a reused family", async () => {
    const root = temp();
    const db = new GameDatabase(join(root, "game.sqlite"), join(process.cwd(), "migrations"));
    const value = game();
    const now = Date.now();
    db.upsertPlayer("p", "dev", "P", now);
    const first = await issueSession(db, value, "p", now);
    const second = await rotateSession(db, value, first.refreshToken, now + 1_000);
    expect(await verifyAccess(value, second.accessToken)).toBe("p");
    await expect(rotateSession(db, value, first.refreshToken, now + 2_000)).rejects.toThrow("reuse");
    await expect(rotateSession(db, value, second.refreshToken, now + 3_000)).rejects.toThrow();
    db.close();
  }, 30_000);
});

describe("real HTTP API", () => {
  it("isolates games, accepts authoritative runs, paginates, and deletes", async () => {
    const app = await buildApp(config(temp(), [game("demo-a"), game("demo-b")]), { logger: false });
    const login = async (id: string, code: string) =>
      (
        await app.inject({
          method: "POST",
          url: `/v1/games/${id}/auth/exchange`,
          payload: { authorizationCode: code },
        })
      ).json<{ accessToken: string; refreshToken: string }>();
    const a = await login("demo-a", "player-a");
    const b = await login("demo-b", "player-a");
    const crossGame = await app.inject({
      method: "GET",
      url: "/v1/games/demo-a/leaderboards/high_score",
      headers: { authorization: `Bearer ${b.accessToken}` },
    });
    expect(crossGame.statusCode, crossGame.body).toBe(401);
    const submitPayload = { runId: "run-http-aaaaaa", payload: { high_score: 99 } };
    const submitted = await app.inject({
      method: "POST",
      url: `/v1/games/demo-a/runs/${adapterIdFor(config())}`,
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: submitPayload,
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/games/demo-a/runs/${adapterIdFor(config())}`,
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: submitPayload,
    });
    expect(replay.json<{ replayed: boolean }>().replayed).toBe(true);
    const anonymousBoard = await app.inject({
      method: "GET",
      url: "/v1/games/demo-a/leaderboards/high_score?limit=1",
    });
    expect(anonymousBoard.statusCode, anonymousBoard.body).toBe(200);
    expect(anonymousBoard.json<{ entries: { value: number }[] }>().entries[0]?.value).toBe(99);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/games/demo-a/leaderboards/high_score/me",
        })
      ).statusCode,
    ).toBe(401);
    const board = await app.inject({
      method: "GET",
      url: "/v1/games/demo-a/leaderboards/high_score?limit=1",
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(board.json<{ entries: { value: number }[] }>().entries[0]?.value).toBe(99);
    const me = await app.inject({
      method: "GET",
      url: "/v1/games/demo-a/leaderboards/high_score/me",
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json<{ entry: { value: number } | null }>().entry?.value).toBe(99);
    const around = await app.inject({
      method: "GET",
      url: "/v1/games/demo-a/leaderboards/high_score/around-me?radius=3",
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(around.statusCode, around.body).toBe(200);
    expect(around.json<{ entries: { value: number }[] }>().entries.some((entry) => entry.value === 99)).toBe(
      true,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/games/demo-a/auth/logout",
          payload: { refreshToken: a.refreshToken },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/games/demo-a/auth/refresh",
          payload: { refreshToken: a.refreshToken },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/games/demo-a/player",
          headers: { authorization: `Bearer ${a.accessToken}` },
        })
      ).statusCode,
    ).toBe(204);
    const emptyPublic = await app.inject({
      method: "GET",
      url: "/v1/games/demo-a/leaderboards/high_score?limit=1",
    });
    expect(emptyPublic.statusCode, emptyPublic.body).toBe(200);
    expect(emptyPublic.json<{ entries: unknown[] }>().entries).toEqual([]);
    await app.close();
  }, 30_000);
  it("serializes concurrent submissions without losing the best", async () => {
    const app = await buildApp(config(), { logger: false });
    const login = await app.inject({
      method: "POST",
      url: "/v1/games/demo/auth/exchange",
      payload: { authorizationCode: "concurrent-player" },
    });
    const token = login.json<{ accessToken: string }>().accessToken;
    const values = Array.from({ length: 10 }, (_, index) =>
      app.inject({
        method: "POST",
        url: `/v1/games/demo/runs/${adapterIdFor(config())}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { runId: `run-concurrent-${index}`, payload: { high_score: index + 1 } },
      }),
    );
    const responses = await Promise.all(values);
    expect(responses.map((response) => response.statusCode)).toEqual(Array(10).fill(200));
    await app.close();
  }, 30_000);
});

// The synthesized adapter id is deterministic: "generic:<sorted board ids>".
// Resolving once via the loader keeps this test agnostic to board additions.
function adapterIdFor(cfg: LoadedConfig): string {
  const game = cfg.games.values().next().value;
  if (!game) throw new Error("test config has no games");
  const spec = game.adapters[0];
  if (!spec || spec.kind !== "generic") throw new Error("test config expects a generic adapter");
  const ids = spec.boards
    .map((b) => b.id)
    .sort()
    .join(",");
  return `generic:${ids}`;
}

describe("graceful boot", () => {
  it("loadConfig returns empty config when manifest file does not exist", () => {
    const dataDir = temp();
    const missing = join(dataDir, "does-not-exist.json");
    const cfg = loadConfig(missing);
    expect(cfg.environment).toBe("development");
    expect(cfg.games.size).toBe(0);
    expect(cfg.manifestPath).toBeUndefined();
    expect(typeof cfg.manifestWritable).toBe("boolean");
  });

  it("loadConfig accepts a manifest with empty games array", () => {
    const dataDir = temp();
    const path = join(dataDir, "games.json");
    writeFileSync(path, JSON.stringify({ environment: "development", games: [] }));
    const cfg = loadConfig(path);
    expect(cfg.games.size).toBe(0);
    expect(cfg.manifestPath).toBe(path);
    expect(cfg.manifestWritable).toBe(true);
  });

  it("buildApp boots empty and serves /readyz with zero games", async () => {
    const dataDir = temp();
    const empty: LoadedConfig = {
      environment: "development",
      dataDir,
      allowedOrigins: [],
      games: new Map(),
      manifestPath: undefined,
      manifestWritable: true,
    };
    const app = await buildApp(empty, { logger: false });
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    const ready = await app.inject({ method: "GET", url: "/readyz" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: "ready", games: [] });
    const missing = await app.inject({ method: "GET", url: "/v1/games/anything/runs/x" });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});

describe("admin auth + manifest edit", () => {
  it("first POST /admin/register creates inaugural admin", async () => {
    const dataDir = temp();
    const app = await buildApp(config(dataDir), { logger: false });
    try {
      // No admins yet → /admin/register renders the form.
      const form = await app.inject({ method: "GET", url: "/admin/register" });
      expect(form.statusCode).toBe(200);
      // The login page renders a registration form (not a login form) when no
      // admin exists. The form action must be /admin/register, otherwise the
      // login handler rejects the submission with "incorrect username or password"
      // and the user reads it as a registration failure.
      const login = await app.inject({ method: "GET", url: "/admin/login" });
      expect(login.statusCode).toBe(200);
      expect(login.body).toMatch(/action="\/admin\/register"/);
      // Submit registration.
      const reg = await app.inject({
        method: "POST",
        url: "/admin/register",
        payload: "username=alice&password=hunter2hunter2&confirm=hunter2hunter2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(reg.statusCode).toBe(302);
      expect(reg.headers["set-cookie"]).toMatch(/bantam_admin=/);
      // Admin row exists.
      const adminDb = new AdminDatabase(join(dataDir, "admin.sqlite"), join(process.cwd(), "migrations"));
      expect(adminDb.countAdmins()).toBe(1);
      adminDb.close();
      // Once an admin exists, /admin/login renders the actual login form.
      const loginAfter = await app.inject({ method: "GET", url: "/admin/login" });
      expect(loginAfter.body).toMatch(/action="\/admin\/login/);
      // Registration is now closed.
      const closed = await app.inject({
        method: "POST",
        url: "/admin/register",
        payload: "username=bob&password=hunter2hunter2&confirm=hunter2hunter2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(closed.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("POST /admin/login with valid creds sets cookie; invalid returns 401", async () => {
    const dataDir = temp();
    const app = await buildApp(config(dataDir), { logger: false });
    try {
      // Bootstrap admin.
      await app.inject({
        method: "POST",
        url: "/admin/register",
        payload: "username=alice&password=hunter2hunter2&confirm=hunter2hunter2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      // /admin/games should require auth (302 to login).
      const blocked = await app.inject({ method: "GET", url: "/admin/games" });
      expect(blocked.statusCode).toBe(302);
      expect(blocked.headers.location).toMatch(/^\/admin\/login/);
      // Valid login → cookie issued + 302 redirect.
      const ok = await app.inject({
        method: "POST",
        url: "/admin/login",
        payload: "username=alice&password=hunter2hunter2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(ok.statusCode).toBe(302);
      expect(ok.headers["set-cookie"]).toMatch(/bantam_admin=/);
      // Bad password → 401.
      const bad = await app.inject({
        method: "POST",
        url: "/admin/login",
        payload: "username=alice&password=wrongpassword",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(bad.statusCode).toBe(401);
      // Bad username format → 400.
      const badFmt = await app.inject({
        method: "POST",
        url: "/admin/login",
        payload: "username=%21invalid&password=hunter2hunter2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(badFmt.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("authenticated admin can POST /admin/manifest and runtime reloads", async () => {
    const dataDir = temp();
    // Set the per-game secrets the manifest loader requires so reload doesn't
    // throw `invalid-secret` before the redirect is sent.
    process.env.BANTAM_GAME_DEMO_IDENTITY_SALT = "test-identity-salt-32-chars-long";
    process.env.BANTAM_GAME_DEMO_SESSION_SECRET = "test-session-secret-32-chars-long";
    process.env.BANTAM_GAME_DEMO_CURSOR_SECRET = "test-cursor-secret-32-chars-long";
    // Start with no games so the empty → filled transition is observable.
    const app = await buildApp(config(dataDir, []), { logger: false });
    try {
      // Bootstrap admin.
      const reg = await app.inject({
        method: "POST",
        url: "/admin/register",
        payload: "username=alice&password=hunter2hunter2&confirm=hunter2hunter2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const cookie = reg.headers["set-cookie"]!.toString().split(";")[0]!;
      // Initial state: no games → /readyz returns 0 games.
      const initial = await app.inject({ method: "GET", url: "/readyz" });
      expect(initial.json()).toMatchObject({ games: [] });
      // Submit manifest JSON with one demo game.
      const manifest = JSON.stringify({
        environment: "development",
        games: [
          {
            id: "demo",
            displayName: "Demo",
            adapters: [
              { kind: "generic", boards: [{ id: "high_score", direction: "higher", period: "all_time" }] },
            ],
            secretPrefix: "BANTAM_GAME_DEMO",
            gracePeriodHours: 24,
            authProvider: "development",
          },
        ],
      });
      const save = await app.inject({
        method: "POST",
        url: "/admin/manifest",
        payload: `manifest=${encodeURIComponent(manifest)}`,
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      });
      expect(save.statusCode).toBe(302);
      expect(save.headers.location).toMatch(/^\/admin\/manifest\?saved=1$/);
      // After reload: /readyz now reports the new game.
      const after = await app.inject({ method: "GET", url: "/readyz" });
      expect(after.json()).toMatchObject({ games: [{ id: "demo", ready: true }] });
      // Manifest file written to dataDir/games.json (resolveManifestPath picks
      // /data/games.json only if it exists; otherwise it picks BANTAM_CONFIG_FILE
      // when set, or fallback when neither resolves. The ManifestStore uses
      // BANTAM_CONFIG_FILE first.)
      const manifestPath = join(dataDir, "games.json");
      expect(readFileSync(manifestPath, "utf8").trim()).toBe(manifest);
    } finally {
      delete process.env.BANTAM_GAME_DEMO_IDENTITY_SALT;
      delete process.env.BANTAM_GAME_DEMO_SESSION_SECRET;
      delete process.env.BANTAM_GAME_DEMO_CURSOR_SECRET;
      await app.close();
    }
  });

  it("manifest edit with invalid JSON returns 400 and shows errors", async () => {
    const dataDir = temp();
    const app = await buildApp(config(dataDir), { logger: false });
    try {
      const reg = await app.inject({
        method: "POST",
        url: "/admin/register",
        payload: "username=alice&password=hunter2hunter2&confirm=hunter2hunter2",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const cookie = reg.headers["set-cookie"]!.toString().split(";")[0]!;
      const bad = await app.inject({
        method: "POST",
        url: "/admin/manifest",
        payload: "manifest=%7Bbad+json",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.body).toMatch(/Invalid JSON/);
    } finally {
      await app.close();
    }
  });
});

// Helpers used by the admin dashboard tests below.
async function adminCookie(app: import("fastify").FastifyInstance): Promise<string> {
  const reg = await app.inject({
    method: "POST",
    url: "/admin/register",
    payload: "username=alice&password=hunter2hunter2&confirm=hunter2hunter2",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return reg.headers["set-cookie"]!.toString().split(";")[0]!;
}

function setDemoEnv(): void {
  // The test `game()` helper uses `secretPrefix: "TEST"`, so required env
  // keys are TEST_IDENTITY_SALT / TEST_SESSION_SECRET / TEST_CURSOR_SECRET.
  process.env.TEST_IDENTITY_SALT = "test-identity-salt-32-chars-long";
  process.env.TEST_SESSION_SECRET = "test-session-secret-32-chars-long";
  process.env.TEST_CURSOR_SECRET = "test-cursor-secret-32-chars-long";
}

function clearDemoEnv(): void {
  delete process.env.TEST_IDENTITY_SALT;
  delete process.env.TEST_SESSION_SECRET;
  delete process.env.TEST_CURSOR_SECRET;
  delete process.env.TEST_PGS_CLIENT_ID;
  delete process.env.TEST_PGS_CLIENT_SECRET;
}

describe("admin dashboard P0 — overview, game page, boards", () => {
  it("overview counts games, players, and runs created today", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      // Seed a player + a run so the count is non-zero.
      const login = await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "p-overview" },
      });
      const token = login.json<{ accessToken: string }>().accessToken;
      await app.inject({
        method: "POST",
        url: `/v1/games/demo/runs/${adapterIdFor(config())}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { runId: "run-overview-1", payload: { high_score: 5 } },
      });
      const page = await app.inject({ method: "GET", url: "/admin/", headers: { cookie } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toMatch(/class="v">1<\/div><div class="l">Games loaded/);
      expect(page.body).toMatch(/class="v">1<\/div><div class="l">Players \(all games\)/);
      expect(page.body).toMatch(/class="v">1<\/div><div class="l">Runs today \(UTC\)/);
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("game page iterates every adapter's boards and shows env presence", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const page = await app.inject({ method: "GET", url: "/admin/games/demo", headers: { cookie } });
      expect(page.statusCode).toBe(200);
      // Both boards in the test adapter are listed (not just the first).
      expect(page.body).toMatch(/href="\/admin\/games\/demo\/boards\/high_score"/);
      expect(page.body).toMatch(/href="\/admin\/games\/demo\/boards\/fastest_finish"/);
      // env-var presence row uses each required key as the visible label.
      expect(page.body).toMatch(/TEST_IDENTITY_SALT/);
      expect(page.body).toMatch(/TEST_SESSION_SECRET/);
      expect(page.body).toMatch(/TEST_CURSOR_SECRET/);
      expect(page.body).toMatch(/present/);
      // Auth badge shows the provider.
      expect(page.body).toMatch(/development/);
      // No raw env values leak into the page.
      expect(page.body).not.toContain("test-identity-salt-32-chars-long");
      expect(page.body).not.toContain("test-session-secret-32-chars-long");
      expect(page.body).not.toContain("test-cursor-secret-32-chars-long");
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("board page lists scores from db.list (all_time + daily)", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const login = await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "p-board" },
      });
      const token = login.json<{ accessToken: string }>().accessToken;
      await app.inject({
        method: "POST",
        url: `/v1/games/demo/runs/${adapterIdFor(config())}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { runId: "run-board-0001", payload: { high_score: 42 } },
      });
      const page = await app.inject({
        method: "GET",
        url: "/admin/games/demo/boards/high_score",
        headers: { cookie },
      });
      expect(page.statusCode).toBe(200);
      // Period key is now in the table footer.
      expect(page.body).toMatch(/period all_time/);
      expect(page.body).toMatch(/all_time/);
      // Score row.
      expect(page.body).toMatch(/42/);
      // Empty-state for an unknown board.
      const missing = await app.inject({
        method: "GET",
        url: "/admin/games/demo/boards/no-such-board",
        headers: { cookie },
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);
});

describe("admin dashboard P1 — players list and delete", () => {
  it("lists players with truncated id and provider, and delete removes them", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      // Seed two players.
      await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "p-list-a" },
      });
      await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "p-list-b" },
      });
      const page = await app.inject({
        method: "GET",
        url: "/admin/games/demo/players",
        headers: { cookie },
      });
      expect(page.statusCode).toBe(200);
      // Two delete disclosures (one per player); the button is revealed only
      // after the operator expands the disclosure so we look for the summary.
      expect((page.body.match(/<summary>Delete player<\/summary>/g) ?? []).length).toBe(2);
      // Provider badge shows the known label.
      expect(page.body).toMatch(/development/);
      // Pick the first player's id from the rendered row (truncated, 8 chars).
      const idMatch = page.body.match(/<code title="(p_[0-9a-f]+)">(p_[0-9a-f]{0,8})<\/code>/);
      expect(idMatch).toBeTruthy();
      const fullId = idMatch![1]!;
      const del = await app.inject({
        method: "POST",
        url: "/admin/games/demo/players/delete",
        payload: `playerId=${encodeURIComponent(fullId)}`,
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      });
      expect(del.statusCode).toBe(302);
      // One fewer player now.
      const after = await app.inject({
        method: "GET",
        url: "/admin/games/demo/players",
        headers: { cookie },
      });
      expect((after.body.match(/<summary>Delete player<\/summary>/g) ?? []).length).toBe(1);
      // Public endpoint confirms deletion on the leaderboard side.
      const board = await app.inject({ method: "GET", url: "/v1/games/demo/leaderboards/high_score" });
      expect(board.json<{ entries: unknown[] }>().entries).toEqual([]);
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("rejects unauthenticated POST /admin/games/:gameId/players/delete", async () => {
    const dataDir = temp();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const blocked = await app.inject({
        method: "POST",
        url: "/admin/games/demo/players/delete",
        payload: "playerId=anything",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(blocked.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe("admin dashboard P2 — settings form, prod guard, rollback", () => {
  it("form path round-trips and reloads without dropping other games", async () => {
    const dataDir = temp();
    setDemoEnv();
    // Direct adminDb + per-game SQLite at the test's tempdir so we don't
    // share /data/admin.sqlite across tests (Windows maps /data → D:/data).
    process.env.BANTAM_DATA_DIR = dataDir;
    // Form path mutates an existing manifest; pre-write one with the demo game
    // so the reload doesn't drop it after the save.
    writeFileSync(
      join(dataDir, "games.json"),
      JSON.stringify({
        environment: "development",
        games: [
          {
            id: "demo",
            displayName: "Demo",
            adapters: [
              { kind: "generic", boards: [{ id: "high_score", direction: "higher", period: "all_time" }] },
            ],
            secretPrefix: "TEST",
            gracePeriodHours: 24,
            authProvider: "development",
          },
        ],
      }),
    );
    const app = await buildApp(loadConfig(join(dataDir, "games.json")), { logger: false });
    try {
      const cookie = await adminCookie(app);
      // Flip gracePeriodHours + displayName via the form (not Advanced JSON).
      const save = await app.inject({
        method: "POST",
        url: "/admin/manifest",
        payload: [
          `environment=development`,
          `game[0].id=demo`,
          `game[0].displayName=Demo Renamed`,
          `game[0].authProvider=development`,
          `game[0].gracePeriodHours=48`,
          `game[0].secretPrefix=TEST`,
        ].join("&"),
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      });
      expect(save.statusCode).toBe(302);
      const page = await app.inject({ method: "GET", url: "/admin/games/demo", headers: { cookie } });
      expect(page.body).toMatch(/Demo Renamed/);
      expect(page.body).toMatch(/48 hours/);
    } finally {
      delete process.env.BANTAM_DATA_DIR;
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("rejects production + development auth at the reload callback", async () => {
    // Boot in production by writing a manifest that declares production +
    // pgs-v2, then attempt a form save that flips auth to development. The
    // boot-rule guard fires in the reload callback, the form returns 500,
    // and the on-disk manifest is rolled back to the prior version.
    const dataDir = temp();
    setDemoEnv();
    // Direct the admin database and per-game SQLite files at the test's
    // tempdir so the test cannot leak state to /data (the default fallback).
    process.env.BANTAM_DATA_DIR = dataDir;
    const initial = JSON.stringify({
      environment: "production",
      games: [
        {
          id: "demo",
          displayName: "Demo",
          adapters: [
            { kind: "generic", boards: [{ id: "high_score", direction: "higher", period: "all_time" }] },
          ],
          secretPrefix: "BANTAM_GAME_DEMO",
          gracePeriodHours: 24,
          authProvider: "pgs-v2",
        },
      ],
    });
    writeFileSync(join(dataDir, "games.json"), initial);
    // Production + pgs-v2 also needs PGS env. Set stubs so reload doesn't
    // also fail on missing secrets — the test isolates the auth guard.
    process.env.BANTAM_GAME_DEMO_IDENTITY_SALT = "test-identity-salt-32-chars-long";
    process.env.BANTAM_GAME_DEMO_SESSION_SECRET = "test-session-secret-32-chars-long";
    process.env.BANTAM_GAME_DEMO_CURSOR_SECRET = "test-cursor-secret-32-chars-long";
    process.env.BANTAM_GAME_DEMO_PGS_CLIENT_ID = "test-pgs-client-id-32-chars-x";
    process.env.BANTAM_GAME_DEMO_PGS_CLIENT_SECRET = "test-pgs-client-secret-32-chars-x";
    const app = await buildApp(loadConfig(join(dataDir, "games.json")), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const save = await app.inject({
        method: "POST",
        url: "/admin/manifest",
        payload: [
          `environment=production`,
          `game[0].id=demo`,
          `game[0].displayName=Demo`,
          `game[0].authProvider=development`,
          `game[0].gracePeriodHours=24`,
          `game[0].secretPrefix=BANTAM_GAME_DEMO`,
        ].join("&"),
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      });
      expect(save.statusCode).toBe(500);
      expect(save.body).toMatch(/rolled back/);
      // Disk reverted to the original auth field.
      const round = readFileSync(join(dataDir, "games.json"), "utf8");
      expect(round).toMatch(/"authProvider":\s*"pgs-v2"/);
    } finally {
      delete process.env.BANTAM_DATA_DIR;
      delete process.env.BANTAM_GAME_DEMO_IDENTITY_SALT;
      delete process.env.BANTAM_GAME_DEMO_SESSION_SECRET;
      delete process.env.BANTAM_GAME_DEMO_CURSOR_SECRET;
      delete process.env.BANTAM_GAME_DEMO_PGS_CLIENT_ID;
      delete process.env.BANTAM_GAME_DEMO_PGS_CLIENT_SECRET;
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("hides the development auth option when environment is production", async () => {
    const dataDir = temp();
    setDemoEnv();
    process.env.BANTAM_DATA_DIR = dataDir;
    process.env.BANTAM_GAME_DEMO_IDENTITY_SALT = "test-identity-salt-32-chars-long";
    process.env.BANTAM_GAME_DEMO_SESSION_SECRET = "test-session-secret-32-chars-long";
    process.env.BANTAM_GAME_DEMO_CURSOR_SECRET = "test-cursor-secret-32-chars-long";
    process.env.BANTAM_GAME_DEMO_PGS_CLIENT_ID = "test-pgs-client-id-32-chars-x";
    process.env.BANTAM_GAME_DEMO_PGS_CLIENT_SECRET = "test-pgs-client-secret-32-chars-x";
    const initial = JSON.stringify({
      environment: "production",
      games: [
        {
          id: "demo",
          displayName: "Demo",
          adapters: [
            { kind: "generic", boards: [{ id: "high_score", direction: "higher", period: "all_time" }] },
          ],
          secretPrefix: "BANTAM_GAME_DEMO",
          gracePeriodHours: 24,
          authProvider: "pgs-v2",
        },
      ],
    });
    writeFileSync(join(dataDir, "games.json"), initial);
    const app = await buildApp(loadConfig(join(dataDir, "games.json")), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const page = await app.inject({ method: "GET", url: "/admin/manifest", headers: { cookie } });
      expect(page.statusCode).toBe(200);
      // The select only offers pgs-v2 (no development option rendered).
      const authSelect = page.body.match(/<select name="game\[0\]\.authProvider">([\s\S]*?)<\/select>/);
      expect(authSelect).toBeTruthy();
      expect(authSelect![1]).toMatch(/value="pgs-v2"/);
      expect(authSelect![1]).not.toMatch(/value="development"/);
      // Production warning is rendered at the top of the page.
      expect(page.body).toMatch(/Production environment:.*rejected/);
    } finally {
      delete process.env.BANTAM_DATA_DIR;
      delete process.env.BANTAM_GAME_DEMO_IDENTITY_SALT;
      delete process.env.BANTAM_GAME_DEMO_SESSION_SECRET;
      delete process.env.BANTAM_GAME_DEMO_CURSOR_SECRET;
      delete process.env.BANTAM_GAME_DEMO_PGS_CLIENT_ID;
      delete process.env.BANTAM_GAME_DEMO_PGS_CLIENT_SECRET;
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);
});

describe("admin dashboard P3 — folded into /admin/health", () => {
  it("health shows env completeness and CORS origin list", async () => {
    const dataDir = temp();
    setDemoEnv();
    process.env.BANTAM_ALLOWED_ORIGINS = "https://example.com, https://other.example";
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const page = await app.inject({ method: "GET", url: "/admin/health", headers: { cookie } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toMatch(/env ok/);
      expect(page.body).toMatch(/https:\/\/example\.com/);
      expect(page.body).toMatch(/https:\/\/other\.example/);
    } finally {
      delete process.env.BANTAM_ALLOWED_ORIGINS;
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);
});

describe("feature flags", () => {
  function row(key: string, overrides: Partial<FeatureFlagRow> = {}): FeatureFlagRow {
    return {
      key,
      description: "",
      enabled: 1,
      rolloutPercent: 100,
      value: null,
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  function form(
    app: import("fastify").FastifyInstance,
    cookie: string,
    payload: string,
    url = "/admin/games/demo/flags",
  ) {
    return app.inject({
      method: "POST",
      url,
      payload,
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    });
  }

  it("gates on the enabled switch before rollout", () => {
    const flags = resolveFlags(
      [row("off", { enabled: 0, rolloutPercent: 100, value: "hidden" })],
      "player-1",
      "salt",
    );
    expect(flags[0]).toEqual({ key: "off", enabled: false, value: null });
  });

  it("returns fully-rolled-out flags to anonymous callers and withholds value when off", () => {
    const flags = resolveFlags(
      [
        row("full", { rolloutPercent: 100, value: "on" }),
        row("partial", { rolloutPercent: 50, value: "maybe" }),
        row("none", { rolloutPercent: 0, value: "never" }),
      ],
      null,
      "salt",
    );
    expect(flags).toEqual([
      { key: "full", enabled: true, value: "on" },
      { key: "partial", enabled: false, value: null },
      { key: "none", enabled: false, value: null },
    ]);
  });

  it("buckets deterministically and spreads partial rollout", () => {
    const flags = [row("partial", { rolloutPercent: 50, value: "x" })];
    const first = resolveFlags(flags, "player-1", "salt")[0];
    const second = resolveFlags(flags, "player-1", "salt")[0];
    expect(first).toEqual(second);
    expect(first?.value).toBe(first?.enabled ? "x" : null);
    const on = Array.from(
      { length: 200 },
      (_, i) => resolveFlags(flags, `player-${i}`, "salt")[0]?.enabled,
    ).filter(Boolean).length;
    expect(on).toBeGreaterThan(60);
    expect(on).toBeLessThan(140);
  });

  it("scopes buckets per game salt so titles cannot be correlated", () => {
    const flags = [row("partial", { rolloutPercent: 50 })];
    const a = Array.from({ length: 100 }, (_, i) => resolveFlags(flags, `p${i}`, "salt-a")[0]?.enabled);
    const b = Array.from({ length: 100 }, (_, i) => resolveFlags(flags, `p${i}`, "salt-b")[0]?.enabled);
    expect(a).not.toEqual(b);
  });

  it("validates flag keys and rollout percent", () => {
    expect(isValidFlagKey("daily_challenge")).toBe(true);
    expect(isValidFlagKey("1bad")).toBe(true);
    expect(isValidFlagKey("Daily")).toBe(false);
    expect(isValidFlagKey("")).toBe(false);
    expect(isValidFlagKey("has space")).toBe(false);
    expect(isValidFlagKey("x".repeat(65))).toBe(false);
    expect(parseRolloutPercent("50")).toBe(50);
    expect(parseRolloutPercent(0)).toBe(0);
    expect(() => parseRolloutPercent("")).toThrow("required");
    expect(() => parseRolloutPercent("50.5")).toThrow("integer");
    expect(() => parseRolloutPercent("101")).toThrow("integer");
  });

  it("rejects a malformed flag key, shows the error banner, and serves valid flags publicly", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const page = await app.inject({ method: "GET", url: "/admin/games/demo/flags", headers: { cookie } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toMatch(/Flags/);

      const bad = await form(app, cookie, "key=Bad+Key&rolloutPercent=100&enabled=true");
      expect(bad.statusCode).toBe(302);
      expect(bad.headers["location"]).toContain("error=");

      const shown = await app.inject({
        method: "GET",
        url: String(bad.headers["location"]),
        headers: { cookie },
      });
      expect(shown.body).toMatch(/Could not save/);
      expect(shown.body).toMatch(/Flag key must match/);

      const missingRollout = await form(app, cookie, "key=ok_key&enabled=true");
      expect(missingRollout.statusCode).toBe(302);
      expect(String(missingRollout.headers["location"])).toContain("error=");

      const good = await form(
        app,
        cookie,
        "key=daily_challenge&description=Test&value=7&rolloutPercent=100&enabled=true",
      );
      expect(good.statusCode).toBe(302);

      const listed = await app.inject({ method: "GET", url: "/admin/games/demo/flags", headers: { cookie } });
      expect(listed.body).toMatch(/daily_challenge/);

      const publicRead = await app.inject({ method: "GET", url: "/v1/games/demo/flags" });
      expect(JSON.parse(publicRead.body)).toEqual({
        flags: [{ key: "daily_challenge", enabled: true, value: "7" }],
      });
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("saves edits from the per-flag form using the path key", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      await form(app, cookie, "key=season_badge&value=s1&rolloutPercent=100&enabled=true");
      const saved = await form(
        app,
        cookie,
        "description=Season&value=s3&rolloutPercent=100&enabled=true",
        "/admin/games/demo/flags/season_badge",
      );
      expect(saved.statusCode).toBe(302);
      expect(String(saved.headers["location"])).not.toContain("error=");
      const read = await app.inject({ method: "GET", url: "/v1/games/demo/flags" });
      expect(JSON.parse(read.body)).toEqual({
        flags: [{ key: "season_badge", enabled: true, value: "s3" }],
      });
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("toggles a flag off without deleting it and withholds its value", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      await form(app, cookie, "key=beta_ui&value=soon&rolloutPercent=100&enabled=true");
      const toggle = await form(app, cookie, "key=beta_ui", "/admin/games/demo/flags/toggle");
      expect(toggle.statusCode).toBe(302);
      const read = await app.inject({ method: "GET", url: "/v1/games/demo/flags" });
      expect(JSON.parse(read.body)).toEqual({ flags: [{ key: "beta_ui", enabled: false, value: null }] });
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("deletes a flag and 404s a missing delete", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      await form(app, cookie, "key=gone_flag&rolloutPercent=100&enabled=true");
      const deleted = await form(app, cookie, "key=gone_flag", "/admin/games/demo/flags/delete");
      expect(deleted.statusCode).toBe(302);
      const empty = await app.inject({ method: "GET", url: "/v1/games/demo/flags" });
      expect(JSON.parse(empty.body)).toEqual({ flags: [] });
      const missing = await form(app, cookie, "key=gone_flag", "/admin/games/demo/flags/delete");
      expect(missing.statusCode).toBe(404);
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("resolves partial rollouts per signed-in player over HTTP", async () => {
    const dataDir = temp();
    setDemoEnv();
    const demo = game();
    const app = await buildApp(config(dataDir, [demo]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      await form(app, cookie, "key=experiment&value=lab&rolloutPercent=50&enabled=true");
      const login = await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "alice" },
      });
      const token = (JSON.parse(login.body) as { accessToken: string }).accessToken;
      const player = await verifyAccess(demo, token);
      const expected = resolveFlags(
        [
          {
            key: "experiment",
            description: "",
            enabled: 1,
            rolloutPercent: 50,
            value: "lab",
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        player,
        demo.identitySalt,
      )[0];
      const anon = await app.inject({ method: "GET", url: "/v1/games/demo/flags" });
      expect(JSON.parse(anon.body)).toEqual({ flags: [{ key: "experiment", enabled: false, value: null }] });
      const authed = await app.inject({
        method: "GET",
        url: "/v1/games/demo/flags",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(JSON.parse(authed.body)).toEqual({ flags: [expected] });
      const badToken = await app.inject({
        method: "GET",
        url: "/v1/games/demo/flags",
        headers: { authorization: "Bearer not-a-token" },
      });
      expect(badToken.statusCode).toBe(401);
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("caps flags per game and keeps writes behind the admin session cookie", async () => {
    const dataDir = temp();
    setDemoEnv();
    const app = await buildApp(config(dataDir, [game()]), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const unauth = await app.inject({
        method: "POST",
        url: "/admin/games/demo/flags",
        payload: "key=sneaky&rolloutPercent=100&enabled=true",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(unauth.statusCode).toBe(401);

      for (let i = 0; i < FLAG_MAX; i += 1) {
        const created = await form(app, cookie, `key=flag-${i}&rolloutPercent=100&enabled=true`);
        expect(created.statusCode).toBe(302);
        expect(String(created.headers["location"])).not.toContain("error=");
      }
      const overflow = await form(app, cookie, "key=flag-overflow&rolloutPercent=100&enabled=true");
      expect(overflow.statusCode).toBe(302);
      expect(String(overflow.headers["location"])).toContain("error=");
      const replace = await form(app, cookie, "key=flag-0&value=ok&rolloutPercent=100&enabled=true");
      expect(String(replace.headers["location"])).not.toContain("error=");
    } finally {
      clearDemoEnv();
      await app.close();
    }
  }, 30_000);

  it("returns fallback from isEnabled when the flag read fails", async () => {
    const client = new BantamClient({
      baseUrl: "http://flags.test",
      gameId: "demo",
      storage: { get: async () => null, set: async () => undefined, remove: async () => undefined },
      fetch: async () => new Response("nope", { status: 500 }),
    });
    expect(await client.isEnabled("daily_challenge", true)).toBe(true);
    await expect(client.getFlags()).rejects.toThrow();
  });

  it("404s for an unknown game", async () => {
    const app = await buildApp(config(temp(), [game()]), { logger: false });
    try {
      const response = await app.inject({ method: "GET", url: "/v1/games/nope/flags" });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  }, 30_000);
});
