import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { BantamError } from "../errors.js";
import { FLAG_MAX } from "../services/feature-flags.js";
import type { BoardDefinition, DerivedBoardValue, FeatureFlag, FeatureFlagRow } from "../types.js";
import { applyMigrations } from "./migrations.js";

export type Player = { id: string; displayName: string };
export type PlayerRow = {
  id: string;
  provider: "pgs-v2" | "development";
  displayName: string;
  createdAt: number;
};
export type SessionRow = {
  token_hash: string;
  player_id: string;
  family_id: string;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
};
export type LeaderboardEntry = { displayName: string; value: number; rank: number };

export class GameDatabase {
  readonly db: Database.Database;

  constructor(
    readonly path: string,
    migrationsDirectory: string,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { timeout: 5_000 });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("wal_autocheckpoint = 1000");
    try {
      applyMigrations(this.db, migrationsDirectory);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
  ready(): boolean {
    return (this.db.prepare("SELECT 1 value").pluck().get() as number) === 1;
  }
  integrity(full = false): string[] {
    const rows = this.db.pragma(full ? "integrity_check" : "quick_check", { simple: false }) as unknown[];
    return rows.map((row) =>
      String(
        (row as { integrity_check?: string; quick_check?: string }).integrity_check ??
          (row as { quick_check?: string }).quick_check,
      ),
    );
  }

  upsertPlayer(id: string, provider: string, displayName: string, now: number): Player {
    this.db
      .prepare(
        `INSERT INTO players(id, provider, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at`,
      )
      .run(id, provider, displayName, now, now);
    return { id, displayName };
  }

  getPlayer(id: string): Player | undefined {
    const row = this.db.prepare("SELECT id, display_name displayName FROM players WHERE id=?").get(id);
    return row as Player | undefined;
  }

  insertRefresh(tokenHash: string, playerId: string, familyId: string, expiresAt: number, now: number): void {
    this.db
      .prepare(
        "INSERT INTO refresh_sessions(token_hash,player_id,family_id,expires_at,created_at) VALUES(?,?,?,?,?)",
      )
      .run(tokenHash, playerId, familyId, expiresAt, now);
  }

  rotateRefresh(
    oldHash: string,
    newHash: string,
    expiresAt: number,
    now: number,
  ): { playerId: string; familyId: string } {
    const result = this.db
      .transaction((): { playerId: string; familyId: string } | { reused: true } => {
        const row = this.db.prepare("SELECT * FROM refresh_sessions WHERE token_hash=?").get(oldHash) as
          | SessionRow
          | undefined;
        if (!row || row.expires_at <= now || row.revoked_at !== null)
          throw new BantamError("reauth-required", "Reauthentication required", 401);
        if (row.used_at !== null) {
          this.db
            .prepare("UPDATE refresh_sessions SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL")
            .run(now, row.family_id);
          return { reused: true };
        }
        this.db.prepare("UPDATE refresh_sessions SET used_at=? WHERE token_hash=?").run(now, oldHash);
        this.insertRefresh(newHash, row.player_id, row.family_id, expiresAt, now);
        return { playerId: row.player_id, familyId: row.family_id };
      })
      .immediate();
    if ("reused" in result) throw new BantamError("refresh-reuse", "Refresh token reuse detected", 401);
    return result;
  }

  revokeRefresh(tokenHash: string, now: number): void {
    const row = this.db
      .prepare("SELECT family_id FROM refresh_sessions WHERE token_hash=?")
      .get(tokenHash) as { family_id: string } | undefined;
    if (row)
      this.db
        .prepare("UPDATE refresh_sessions SET revoked_at=? WHERE family_id=? AND revoked_at IS NULL")
        .run(now, row.family_id);
  }

  takeRate(playerId: string, category: string, limit: number, now: number): void {
    const bucket = Math.floor(now / 60_000);
    const result = this.db
      .prepare(
        `INSERT INTO rate_limits(player_id,category,bucket,count) VALUES(?,?,?,1)
      ON CONFLICT(player_id,category,bucket) DO UPDATE SET count=count+1 RETURNING count`,
      )
      .get(playerId, category, bucket) as { count: number };
    if (result.count > limit) throw new BantamError("rate-limited", "Rate limit exceeded", 429);
    if (Math.random() < 0.01) this.db.prepare("DELETE FROM rate_limits WHERE bucket < ?").run(bucket - 2);
  }

  submitRun(args: {
    adapterId: string;
    playerId: string;
    runId: string;
    payloadHash: string;
    values: DerivedBoardValue[];
    boards: readonly BoardDefinition[];
    response: Record<string, unknown>;
    now: number;
  }): { response: Record<string, unknown>; replayed: boolean } {
    return this.db
      .transaction(() => {
        const previous = this.db
          .prepare(
            "SELECT payload_hash,response_json FROM runs WHERE adapter_id=? AND player_id=? AND run_id=?",
          )
          .get(args.adapterId, args.playerId, args.runId) as
          | { payload_hash: string; response_json: string }
          | undefined;
        if (previous) {
          if (previous.payload_hash !== args.payloadHash)
            throw new BantamError("run-id-conflict", "Run id reused with different content", 409);
          return { response: JSON.parse(previous.response_json) as Record<string, unknown>, replayed: true };
        }
        const improvements: Array<{ boardId: string; periodKey: string; value: number; improved: boolean }> =
          [];
        for (const value of args.values) {
          const board = args.boards.find((candidate) => candidate.id === value.boardId);
          if (!board || !Number.isSafeInteger(value.value))
            throw new BantamError("adapter-result", "Adapter produced an invalid board result", 500);
          const prior = this.db
            .prepare(
              "SELECT value FROM leaderboard_entries WHERE board_id=? AND period_key=? AND player_id=?",
            )
            .get(value.boardId, value.periodKey, args.playerId) as { value: number } | undefined;
          const improved =
            !prior || (board.direction === "higher" ? value.value > prior.value : value.value < prior.value);
          if (improved) {
            this.db
              .prepare(
                `INSERT INTO leaderboard_entries(board_id,period_key,player_id,value,achieved_at,run_id)
            VALUES(?,?,?,?,?,?) ON CONFLICT(board_id,period_key,player_id) DO UPDATE SET
            value=excluded.value, achieved_at=excluded.achieved_at, run_id=excluded.run_id`,
              )
              .run(value.boardId, value.periodKey, args.playerId, value.value, args.now, args.runId);
          }
          improvements.push({ ...value, improved });
        }
        const response = { ...args.response, improvements };
        this.db
          .prepare(
            "INSERT INTO runs(adapter_id,player_id,run_id,payload_hash,response_json,created_at) VALUES(?,?,?,?,?,?)",
          )
          .run(
            args.adapterId,
            args.playerId,
            args.runId,
            args.payloadHash,
            JSON.stringify(response),
            args.now,
          );
        return { response, replayed: false };
      })
      .immediate();
  }

  list(
    board: BoardDefinition,
    periodKey: string,
    afterOrdinal: number,
    limit: number,
  ): Array<LeaderboardEntry & { ordinal: number }> {
    const direction = board.direction === "higher" ? "DESC" : "ASC";
    return this.db
      .prepare(
        `SELECT display_name displayName,value,rank,ordinal FROM (
      SELECT p.display_name,e.value,
        RANK() OVER (ORDER BY e.value ${direction}) rank,
        ROW_NUMBER() OVER (ORDER BY e.value ${direction}, e.achieved_at ASC, e.id ASC) ordinal
      FROM leaderboard_entries e JOIN players p ON p.id=e.player_id
      WHERE e.board_id=? AND e.period_key=?) WHERE ordinal>? ORDER BY ordinal LIMIT ?`,
      )
      .all(board.id, periodKey, afterOrdinal, limit) as Array<LeaderboardEntry & { ordinal: number }>;
  }

  playerEntry(
    board: BoardDefinition,
    periodKey: string,
    playerId: string,
  ): (LeaderboardEntry & { ordinal: number }) | undefined {
    const direction = board.direction === "higher" ? "DESC" : "ASC";
    return this.db
      .prepare(
        `SELECT displayName,value,rank,ordinal FROM (
      SELECT e.player_id,p.display_name displayName,e.value,
        RANK() OVER (ORDER BY e.value ${direction}) rank,
        ROW_NUMBER() OVER (ORDER BY e.value ${direction}, e.achieved_at ASC, e.id ASC) ordinal
      FROM leaderboard_entries e JOIN players p ON p.id=e.player_id
      WHERE e.board_id=? AND e.period_key=?) WHERE player_id=?`,
      )
      .get(board.id, periodKey, playerId) as (LeaderboardEntry & { ordinal: number }) | undefined;
  }

  around(
    board: BoardDefinition,
    periodKey: string,
    playerId: string,
    radius: number,
  ): Array<LeaderboardEntry & { ordinal: number }> {
    const player = this.playerEntry(board, periodKey, playerId);
    if (!player) return [];
    const direction = board.direction === "higher" ? "DESC" : "ASC";
    return this.db
      .prepare(
        `SELECT displayName,value,rank,ordinal FROM (
      SELECT p.display_name displayName,e.value,
        RANK() OVER (ORDER BY e.value ${direction}) rank,
        ROW_NUMBER() OVER (ORDER BY e.value ${direction},e.achieved_at ASC,e.id ASC) ordinal
      FROM leaderboard_entries e JOIN players p ON p.id=e.player_id
      WHERE e.board_id=? AND e.period_key=?) WHERE ordinal BETWEEN ? AND ? ORDER BY ordinal`,
      )
      .all(board.id, periodKey, Math.max(1, player.ordinal - radius), player.ordinal + radius) as Array<
      LeaderboardEntry & { ordinal: number }
    >;
  }

  deletePlayer(playerId: string): number {
    return this.db
      .transaction(() => this.db.prepare("DELETE FROM players WHERE id=?").run(playerId).changes)
      .immediate();
  }

  // Admin-only listing. Returns the player id, display name, provider label,
  // and creation timestamp. Order is most-recent first so operators see
  // fresh signups at the top of the page.
  listPlayers(limit = 200): PlayerRow[] {
    return this.db
      .prepare(
        "SELECT id, provider, display_name displayName, created_at createdAt FROM players ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as PlayerRow[];
  }

  countPlayers(): number {
    return (this.db.prepare("SELECT count(*) value FROM players").pluck().get() as number) ?? 0;
  }

  recentRuns(
    limit: number,
  ): Array<{ runId: string; adapterId: string; createdAt: Date; payloadHash: string }> {
    const rows = this.db
      .prepare(
        "SELECT run_id runId, adapter_id adapterId, created_at createdAt, payload_hash payloadHash FROM runs ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as Array<{ runId: string; adapterId: string; createdAt: number; payloadHash: string }>;
    return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }));
  }

  listFlags(): FeatureFlagRow[] {
    return this.db
      .prepare(
        "SELECT key,description,enabled,rollout_percent rolloutPercent,value,created_at createdAt,updated_at updatedAt FROM feature_flags ORDER BY key",
      )
      .all() as FeatureFlagRow[];
  }

  getFlag(key: string): FeatureFlagRow | undefined {
    return this.db
      .prepare(
        "SELECT key,description,enabled,rollout_percent rolloutPercent,value,created_at createdAt,updated_at updatedAt FROM feature_flags WHERE key=?",
      )
      .get(key) as FeatureFlagRow | undefined;
  }

  upsertFlag(flag: FeatureFlag, now: number): FeatureFlagRow {
    if (!Number.isInteger(flag.rolloutPercent) || flag.rolloutPercent < 0 || flag.rolloutPercent > 100) {
      throw new BantamError("invalid-flag", "Rollout percent must be an integer 0-100", 400);
    }
    const existing = this.getFlag(flag.key);
    if (!existing && this.countFlags() >= FLAG_MAX) {
      throw new BantamError("flag-limit", `This game already has ${FLAG_MAX} flags`, 400);
    }
    this.db
      .prepare(
        `INSERT INTO feature_flags(key,description,enabled,rollout_percent,value,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
      description=excluded.description, enabled=excluded.enabled,
      rollout_percent=excluded.rollout_percent, value=excluded.value, updated_at=excluded.updated_at`,
      )
      .run(flag.key, flag.description, flag.enabled ? 1 : 0, flag.rolloutPercent, flag.value, now, now);
    const row = this.getFlag(flag.key);
    if (!row) throw new BantamError("flag-write-failed", "Flag upsert lost", 500);
    return row;
  }

  deleteFlag(key: string): number {
    return this.db.prepare("DELETE FROM feature_flags WHERE key=?").run(key).changes;
  }

  countFlags(): number {
    return (this.db.prepare("SELECT count(*) value FROM feature_flags").pluck().get() as number) ?? 0;
  }
}
