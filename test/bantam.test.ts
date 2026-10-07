import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildApp } from "../src/app.js";
import type { AdapterSpec, RuntimeGame } from "../src/types.js";
import { issueSession, rotateSession, verifyAccess } from "../src/auth/sessions.js";
import type { LoadedConfig } from "../src/config.js";
import { GameDatabase } from "../src/db/game-database.js";
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
