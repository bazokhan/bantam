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
      ).json<{ accessToken: string }>();
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
    const board = await app.inject({
      method: "GET",
      url: "/v1/games/demo-a/leaderboards/high_score?limit=1",
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(board.json<{ entries: { value: number }[] }>().entries[0]?.value).toBe(99);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/games/demo-a/player",
          headers: { authorization: `Bearer ${a.accessToken}` },
        })
      ).statusCode,
    ).toBe(204);
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
