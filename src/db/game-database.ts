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
export type WalletBalance = { currencyId: string; balance: number };
export type WalletTransactionRow = {
  id: number;
  playerId: string;
  currencyId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  balanceAfter: number;
  createdAt: number;
};
export type WalletMutationResult = {
  balance: number;
  transactionId: number;
  replayed: boolean;
};

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

  getWallet(playerId: string): WalletBalance[] {
    return this.db
      .prepare("SELECT currency_id currencyId, balance FROM wallets WHERE player_id=? ORDER BY currency_id")
      .all(playerId) as WalletBalance[];
  }

  listWalletTransactions(playerId: string, limit = 100): WalletTransactionRow[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new BantamError(
        "invalid-limit",
        "Wallet transaction limit must be an integer from 1 to 500",
        400,
      );
    return this.db
      .prepare(
        `SELECT id, player_id playerId, currency_id currencyId, amount, reason,
          idempotency_key idempotencyKey, balance_after balanceAfter, created_at createdAt
        FROM wallet_transactions WHERE player_id=? ORDER BY id DESC LIMIT ?`,
      )
      .all(playerId, limit) as WalletTransactionRow[];
  }

  creditCurrency(
    playerId: string,
    currencyId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
    now: number,
  ): WalletMutationResult {
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new BantamError("invalid-amount", "Currency amount must be a positive safe integer", 400);
    return this.mutateCurrency(playerId, currencyId, amount, reason, idempotencyKey, now);
  }

  debitCurrency(
    playerId: string,
    currencyId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
    now: number,
  ): WalletMutationResult {
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new BantamError("invalid-amount", "Currency amount must be a positive safe integer", 400);
    return this.mutateCurrency(playerId, currencyId, -amount, reason, idempotencyKey, now);
  }

  private mutateCurrency(
    playerId: string,
    currencyId: string,
    delta: number,
    reason: string,
    idempotencyKey: string,
    now: number,
  ): WalletMutationResult {
    if (!playerId || playerId.length > 128)
      throw new BantamError(
        "invalid-player",
        "Player id is required and must be at most 128 characters",
        400,
      );
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(currencyId))
      throw new BantamError(
        "invalid-currency",
        "Currency id must be lowercase and use letters, digits, _ or -",
        400,
      );
    if (!Number.isSafeInteger(delta) || delta === 0)
      throw new BantamError("invalid-amount", "Currency amount must be a non-zero safe integer", 400);
    if (!/^[a-z][a-z0-9_.:-]{0,63}$/.test(reason))
      throw new BantamError("invalid-reason", "Transaction reason has an invalid format", 400);
    if (
      !idempotencyKey ||
      idempotencyKey.length > 128 ||
      idempotencyKey.trim() !== idempotencyKey ||
      /[\u0000-\u001f\u007f]/u.test(idempotencyKey)
    )
      throw new BantamError(
        "invalid-idempotency-key",
        "Idempotency key must be 1-128 printable characters",
        400,
      );
    if (!Number.isSafeInteger(now) || now < 0)
      throw new BantamError("invalid-timestamp", "Timestamp must be a non-negative safe integer", 400);

    return this.db
      .transaction((): WalletMutationResult => {
        const player = this.db.prepare("SELECT 1 FROM players WHERE id=?").get(playerId);
        if (!player) throw new BantamError("player-not-found", "Player not found", 404);

        const previous = this.db
          .prepare(
            `SELECT id, currency_id currencyId, amount, reason, idempotency_key idempotencyKey,
              balance_after balanceAfter
            FROM wallet_transactions WHERE player_id=? AND idempotency_key=?`,
          )
          .get(playerId, idempotencyKey) as
          | {
              id: number;
              currencyId: string;
              amount: number;
              reason: string;
              idempotencyKey: string;
              balanceAfter: number;
            }
          | undefined;
        if (previous) {
          if (
            previous.currencyId !== currencyId ||
            previous.amount !== delta ||
            previous.reason !== reason
          )
            throw new BantamError(
              "idempotency-conflict",
              "Idempotency key was already used for a different currency operation",
              409,
            );
          return { balance: previous.balanceAfter, transactionId: previous.id, replayed: true };
        }

        const wallet = this.db
          .prepare("SELECT balance FROM wallets WHERE player_id=? AND currency_id=?")
          .get(playerId, currencyId) as { balance: number } | undefined;
        const currentBalance = wallet?.balance ?? 0;
        if (delta < 0 && currentBalance < -delta)
          throw new BantamError("insufficient-funds", "Insufficient currency balance", 409);
        const nextBalance = currentBalance + delta;
        if (!Number.isSafeInteger(nextBalance) || nextBalance < 0)
          throw new BantamError(
            "balance-overflow",
            "Currency balance would exceed the supported integer range",
            409,
          );

        this.db
          .prepare(
            `INSERT INTO wallets(player_id, currency_id, balance, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(player_id, currency_id) DO UPDATE SET
              balance=excluded.balance, updated_at=excluded.updated_at`,
          )
          .run(playerId, currencyId, nextBalance, now, now);

        const inserted = this.db
          .prepare(
            `INSERT INTO wallet_transactions(
              player_id, currency_id, amount, reason, idempotency_key, balance_after, created_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(playerId, currencyId, delta, reason, idempotencyKey, nextBalance, now);

        return { balance: nextBalance, transactionId: Number(inserted.lastInsertRowid), replayed: false };
      })
      .immediate();
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
