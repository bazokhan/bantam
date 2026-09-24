import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildApp } from "../src/app.js";
import { ColorQuestDailyV1Adapter } from "../src/adapters/color-quest-daily-v1.js";
import { buildDailyDefinition, scoreCompetitiveGate } from "../src/adapters/color-quest-core.js";
import { issueSession, rotateSession, verifyAccess } from "../src/auth/sessions.js";
import type { LoadedConfig } from "../src/config.js";
import { GameDatabase } from "../src/db/game-database.js";
import { decodeCursor, encodeCursor } from "../src/services/cursor.js";
import { derivePlayerId } from "../src/util/crypto.js";
import { sanitizeDisplayName } from "../src/util/display-name.js";
import { BantamError } from "../src/errors.js";

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
function game(id = "color-quest") {
  return {
    id,
    displayName: id,
    adapters: ["color-quest-daily-v1"],
    secretPrefix: "TEST",
    gracePeriodHours: 48,
    authProvider: "development" as const,
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

export function validDaily(date = "2026-09-23") {
  const route = buildDailyDefinition(date);
  const eventLedger: Record<string, unknown>[] = [];
  let score = 0,
    combo = 0,
    streak = 0,
    activeMs = 0;
  route.chunks.forEach((chunk, index) => {
    activeMs += 5_000;
    const gate = scoreCompetitiveGate("regular", streak, combo, 1, 5_000);
    combo = gate.nextCombo;
    streak = gate.nextPerfectStreak;
    score += gate.totalPoints;
    eventLedger.push({
      type: "gate",
      gate: index + 1,
      obstacleId: chunk.obstacle.id,
      result: "regular",
      alignment: 0.5,
      gateActiveMs: 5_000,
      activeMs,
      points: gate.totalPoints,
      pace: gate.pacePoints,
    });
  });
  eventLedger.push({ type: "end", activeMs, reason: "daily_complete" });
  return {
    runId: "run-valid-1234",
    utcDate: date,
    rulesVersion: "daily-v1",
    seed: route.seed,
    score,
    distanceMeters: 0,
    activeTimeMs: activeMs,
    completed: true,
    gatesCleared: 20,
    eventLedger,
    createdAtMs: Date.parse(`${date}T12:00:00Z`),
  };
}

describe("security primitives", () => {
  it("derives per-game pseudonyms and sanitizes names", () => {
    expect(derivePlayerId("pgs-v2", "raw-player", "salt-a")).not.toBe(
      derivePlayerId("pgs-v2", "raw-player", "salt-b"),
    );
    expect(sanitizeDisplayName(" \u202e  Alice\u0000   Player  ")).toBe("Alice Player");
    expect([...sanitizeDisplayName("😀".repeat(30))]).toHaveLength(24);
  });
  it("signs and rejects altered cursors", () => {
    const cursor = encodeCursor(42, secret);
    expect(decodeCursor(cursor, secret)).toBe(42);
    expect(() => decodeCursor(`${cursor}x`, secret)).toThrow("Invalid");
  });
});

describe("Color Quest daily-v1", () => {
  const adapter = new ColorQuestDailyV1Adapter();
  const nowMs = Date.parse("2026-09-24T00:00:00Z");
  it("accepts the committed complete and partial golden submissions", () => {
    const golden = JSON.parse(
      readFileSync(join(process.cwd(), "fixtures", "color-quest", "daily-v1.golden.json"), "utf8"),
    ) as { validComplete: unknown; validPartial: unknown; rejectionClasses: string[] };
    expect(
      adapter.validateAndDerive(golden.validComplete, { nowMs, gracePeriodHours: 48 }).values,
    ).toHaveLength(2);
    expect(
      adapter.validateAndDerive(golden.validPartial, { nowMs, gracePeriodHours: 48 }).values,
    ).toHaveLength(1);
    expect(golden.rejectionClasses).toHaveLength(18);
  });
  it("regenerates a route and derives both boards", () => {
    const result = adapter.validateAndDerive(validDaily(), { nowMs, gracePeriodHours: 48 });
    expect(result.values.map((value) => value.boardId)).toEqual(["daily_score", "daily_fastest_finish"]);
  });
  it.each([
    [
      "seed",
      (value: ReturnType<typeof validDaily>) => {
        value.seed = "wrong";
      },
      "invalid-route",
    ],
    [
      "score",
      (value: ReturnType<typeof validDaily>) => {
        value.score += 1;
      },
      "score-mismatch",
    ],
    [
      "time",
      (value: ReturnType<typeof validDaily>) => {
        value.activeTimeMs = 1;
      },
      "time-mismatch",
    ],
    [
      "event after end",
      (value: ReturnType<typeof validDaily>) => {
        value.eventLedger.push({ type: "end", activeMs: value.activeTimeMs });
      },
      "event-after-end",
    ],
    [
      "revive",
      (value: ReturnType<typeof validDaily>) => {
        value.eventLedger.unshift({ type: "rewarded_revive", activeMs: 0 });
      },
      "daily-revive-forbidden",
    ],
  ])("rejects %s tampering", (_name, mutate, code) => {
    const value = validDaily();
    mutate(value);
    expect(errorCode(() => adapter.validateAndDerive(value, { nowMs, gracePeriodHours: 48 }))).toBe(code);
  });
  it("rejects an expired offline run", () =>
    expect(() =>
      adapter.validateAndDerive(validDaily(), {
        nowMs: Date.parse("2026-09-26T00:00:01Z"),
        gracePeriodHours: 48,
      }),
    ).toThrow("expired"));
  it("rejects duplicate and impossible pickups", () => {
    const value = validDaily();
    const route = buildDailyDefinition(value.utcDate);
    const index = route.chunks.findIndex((chunk) => chunk.reward !== "none");
    const kind = route.chunks[index]!.reward;
    value.eventLedger.unshift(
      {
        type: "pickup",
        kind,
        gate: index,
        activeMs: 0,
        points: kind === "star" ? 5 : kind === "gem" ? 10 : 0,
      },
      {
        type: "pickup",
        kind,
        gate: index,
        activeMs: 0,
        points: kind === "star" ? 5 : kind === "gem" ? 10 : 0,
      },
    );
    expect(() => adapter.validateAndDerive(value, { nowMs, gracePeriodHours: 48 })).toThrow("Duplicate");
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
    const app = await buildApp(config(temp(), [game("color-quest"), game("color-quest-two")]), {
      logger: false,
    });
    const login = async (id: string, code: string) =>
      (
        await app.inject({
          method: "POST",
          url: `/v1/games/${id}/auth/exchange`,
          payload: { authorizationCode: code },
        })
      ).json<{ accessToken: string }>();
    const a = await login("color-quest", "player-a");
    const b = await login("color-quest-two", "player-a");
    const crossGame = await app.inject({
      method: "GET",
      url: "/v1/games/color-quest/leaderboards/daily_score?period=2026-09-23",
      headers: { authorization: `Bearer ${b.accessToken}` },
    });
    expect(crossGame.statusCode, crossGame.body).toBe(401);
    const payload = validDaily();
    const submitted = await app.inject({
      method: "POST",
      url: "/v1/games/color-quest/runs/color-quest-daily-v1",
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: { runId: payload.runId, payload },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/games/color-quest/runs/color-quest-daily-v1",
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: { runId: payload.runId, payload },
    });
    expect(replay.json<{ replayed: boolean }>().replayed).toBe(true);
    const board = await app.inject({
      method: "GET",
      url: "/v1/games/color-quest/leaderboards/daily_score?period=2026-09-23&limit=1",
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(board.json<{ entries: unknown[] }>().entries).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/v1/games/color-quest/player",
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
      url: "/v1/games/color-quest/auth/exchange",
      payload: { authorizationCode: "concurrent-player" },
    });
    const token = login.json<{ accessToken: string }>().accessToken;
    const values = Array.from({ length: 10 }, (_, index) => {
      const payload = validDaily();
      payload.runId = `run-concurrent-${index}`;
      return app.inject({
        method: "POST",
        url: "/v1/games/color-quest/runs/color-quest-daily-v1",
        headers: { authorization: `Bearer ${token}` },
        payload: { runId: payload.runId, payload },
      });
    });
    const responses = await Promise.all(values);
    expect(responses.map((response) => response.statusCode)).toEqual(Array(10).fill(200));
    await app.close();
  }, 30_000);
});
