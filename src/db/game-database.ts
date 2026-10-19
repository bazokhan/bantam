import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { BantamError } from "../errors.js";
import type {
  EconomyCatalog,
  EconomyGrant,
  EconomyItem,
  EconomyIapProduct,
  EconomyOffer,
  EconomyReward,
} from "../services/economy.js";
import { catalogItem, isUsable } from "../services/economy.js";
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
export type InventoryItem = { itemId: string; quantity: number };
export type InventoryTransactionRow = {
  id: number;
  playerId: string;
  itemId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  quantityAfter: number;
  createdAt: number;
};
export type InventoryMutationResult = {
  quantity: number;
  transactionId: number;
  replayed: boolean;
};
export type StorePurchaseRow = {
  id: number;
  playerId: string;
  offerId: string;
  itemId: string;
  quantity: number;
  currencyId: string;
  priceAmount: number;
  idempotencyKey: string;
  walletTransactionId: number;
  createdAt: number;
};
export type StorePurchaseResult = {
  purchaseId: number;
  itemId: string;
  quantity: number;
  quantityAfter: number;
  wallet: WalletMutationResult;
  replayed: boolean;
};
export type ItemUseResult = {
  itemId: string;
  consumedQuantity: number;
  quantityAfter: number;
  replayed: boolean;
};
export type RewardClaimResult = {
  rewardId: string;
  wallet: WalletBalance[];
  inventory: InventoryItem[];
  replayed: boolean;
};
export type IapPurchaseRow = {
  id: number;
  playerId: string;
  provider: string;
  productId: string;
  providerProductId: string;
  purchaseTokenHash: string;
  orderId: string | null;
  verificationState: string;
  fulfillmentState: string;
  acknowledgeState: string;
  createdAt: number;
  updatedAt: number;
};
export type IapFulfillmentResult = {
  purchase: IapPurchaseRow;
  wallet: WalletBalance[];
  inventory: InventoryItem[];
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
          if (previous.currencyId !== currencyId || previous.amount !== delta || previous.reason !== reason)
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

  getInventory(playerId: string): InventoryItem[] {
    return this.db
      .prepare(
        "SELECT item_id itemId, quantity FROM inventory WHERE player_id=? AND quantity>0 ORDER BY item_id",
      )
      .all(playerId) as InventoryItem[];
  }

  listInventoryTransactions(playerId: string, limit = 100): InventoryTransactionRow[] {
    this.assertLimit(limit);
    return this.db
      .prepare(
        `SELECT id, player_id playerId, item_id itemId, amount, reason,
          idempotency_key idempotencyKey, quantity_after quantityAfter, created_at createdAt
        FROM inventory_transactions WHERE player_id=? ORDER BY id DESC LIMIT ?`,
      )
      .all(playerId, limit) as InventoryTransactionRow[];
  }

  listStorePurchases(playerId: string, limit = 100): StorePurchaseRow[] {
    this.assertLimit(limit);
    return this.db
      .prepare(
        `SELECT id, player_id playerId, offer_id offerId, item_id itemId, quantity,
          currency_id currencyId, price_amount priceAmount, idempotency_key idempotencyKey,
          wallet_transaction_id walletTransactionId, created_at createdAt
        FROM store_purchases WHERE player_id=? ORDER BY id DESC LIMIT ?`,
      )
      .all(playerId, limit) as StorePurchaseRow[];
  }

  countOfferPurchases(playerId: string, offerId: string): number {
    return (
      (this.db
        .prepare("SELECT count(*) value FROM store_purchases WHERE player_id=? AND offer_id=?")
        .pluck()
        .get(playerId, offerId) as number) ?? 0
    );
  }

  offerPurchaseCounts(playerId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        "SELECT offer_id offerId, count(*) count FROM store_purchases WHERE player_id=? GROUP BY offer_id",
      )
      .all(playerId) as Array<{ offerId: string; count: number }>;
    return new Map(rows.map((row) => [row.offerId, row.count]));
  }

  grantItem(
    playerId: string,
    item: EconomyItem,
    quantity: number,
    reason: string,
    idempotencyKey: string,
    now: number,
  ): InventoryMutationResult {
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      throw new BantamError("invalid-amount", "Item quantity must be a positive safe integer", 400);
    return this.mutateInventory(playerId, item, quantity, reason, idempotencyKey, now);
  }

  consumeItem(
    playerId: string,
    item: EconomyItem,
    quantity: number,
    reason: string,
    idempotencyKey: string,
    now: number,
  ): InventoryMutationResult {
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      throw new BantamError("invalid-amount", "Item quantity must be a positive safe integer", 400);
    return this.mutateInventory(playerId, item, -quantity, reason, idempotencyKey, now);
  }

  purchaseOffer(
    playerId: string,
    offer: EconomyOffer,
    item: EconomyItem,
    requestId: string,
    now: number,
    priceAmount: number = offer.priceAmount,
  ): StorePurchaseResult {
    if (offer.active === false) throw new BantamError("offer-inactive", "Store offer is not available", 409);
    if (offer.itemId !== item.id)
      throw new BantamError("offer-item-mismatch", "Offer item does not match the catalog item", 500);
    if (!Number.isInteger(priceAmount) || priceAmount < 1)
      throw new BantamError("offer-inactive", "Store offer price is invalid", 500);
    return this.db
      .transaction((): StorePurchaseResult => {
        const previous = this.db
          .prepare(
            `SELECT id, offer_id offerId, item_id itemId, quantity, wallet_transaction_id walletTransactionId
            FROM store_purchases WHERE player_id=? AND idempotency_key=?`,
          )
          .get(playerId, requestId) as
          | {
              id: number;
              offerId: string;
              itemId: string;
              quantity: number;
              walletTransactionId: number;
            }
          | undefined;
        if (previous) {
          if (
            previous.offerId !== offer.id ||
            previous.itemId !== offer.itemId ||
            previous.quantity !== offer.quantity
          )
            throw new BantamError(
              "idempotency-conflict",
              "Idempotency key was already used for a different store purchase",
              409,
            );
          const wallet = this.walletTransaction(previous.walletTransactionId);
          const owned = this.inventoryQuantity(playerId, item.id);
          return {
            purchaseId: previous.id,
            itemId: item.id,
            quantity: previous.quantity,
            quantityAfter: owned,
            wallet: { balance: wallet.balanceAfter, transactionId: wallet.id, replayed: true },
            replayed: true,
          };
        }

        if (offer.maxPerPlayer !== undefined) {
          const used = this.countOfferPurchases(playerId, offer.id);
          if (used >= offer.maxPerPlayer)
            throw new BantamError(
              "offer-limit",
              "This offer has already been purchased the maximum times",
              409,
            );
        }
        if (item.type === "permanent" && this.inventoryQuantity(playerId, item.id) > 0)
          throw new BantamError("already-owned", "This item is already owned", 409);

        const wallet = this.debitCurrency(
          playerId,
          offer.priceCurrencyId,
          priceAmount,
          "item_purchase",
          requestId,
          now,
        );
        const granted = this.grantItem(
          playerId,
          item,
          offer.quantity,
          "item_purchase",
          `purchase:${requestId}`,
          now,
        );
        const inserted = this.db
          .prepare(
            `INSERT INTO store_purchases(
              player_id, offer_id, item_id, quantity, currency_id, price_amount,
              idempotency_key, wallet_transaction_id, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            playerId,
            offer.id,
            item.id,
            offer.quantity,
            offer.priceCurrencyId,
            priceAmount,
            requestId,
            wallet.transactionId,
            now,
          );
        return {
          purchaseId: Number(inserted.lastInsertRowid),
          itemId: item.id,
          quantity: offer.quantity,
          quantityAfter: granted.quantity,
          wallet,
          replayed: false,
        };
      })
      .immediate();
  }

  useItem(playerId: string, item: EconomyItem, requestId: string, now: number): ItemUseResult {
    if (!isUsable(item)) throw new BantamError("item-not-usable", "This item cannot be used", 409);
    this.assertPlayerId(playerId);
    this.assertIdempotencyKey(requestId);
    this.assertTimestamp(now);
    return this.db
      .transaction((): ItemUseResult => {
        const previous = this.db
          .prepare(
            `SELECT item_id itemId, consumed_quantity consumedQuantity, quantity_after quantityAfter
            FROM item_uses WHERE player_id=? AND idempotency_key=?`,
          )
          .get(playerId, requestId) as
          | { itemId: string; consumedQuantity: number; quantityAfter: number }
          | undefined;
        if (previous) {
          if (previous.itemId !== item.id)
            throw new BantamError(
              "idempotency-conflict",
              "Idempotency key was already used for a different item use",
              409,
            );
          return {
            itemId: item.id,
            consumedQuantity: previous.consumedQuantity,
            quantityAfter: previous.quantityAfter,
            replayed: true,
          };
        }
        const consumed = item.type === "consumable" ? 1 : 0;
        const remaining =
          consumed > 0
            ? this.consumeItem(playerId, item, consumed, "item_use", `use:${requestId}`, now).quantity
            : this.inventoryQuantity(playerId, item.id);
        if (item.type === "permanent" && remaining < 1)
          throw new BantamError("item-not-owned", "Item is not in inventory", 409);
        this.db
          .prepare(
            `INSERT INTO item_uses(player_id, item_id, consumed_quantity, idempotency_key, quantity_after, created_at)
            VALUES(?,?,?,?,?,?)`,
          )
          .run(playerId, item.id, consumed, requestId, remaining, now);
        return { itemId: item.id, consumedQuantity: consumed, quantityAfter: remaining, replayed: false };
      })
      .immediate();
  }

  countRewardClaims(playerId: string, rewardId: string): number {
    return (
      (this.db
        .prepare("SELECT count(*) value FROM reward_claims WHERE player_id=? AND reward_id=?")
        .pluck()
        .get(playerId, rewardId) as number) ?? 0
    );
  }

  claimReward(
    playerId: string,
    reward: EconomyReward,
    catalog: EconomyCatalog,
    requestId: string,
    now: number,
  ): RewardClaimResult {
    this.assertPlayerId(playerId);
    this.assertIdempotencyKey(requestId);
    this.assertTimestamp(now);
    return this.db
      .transaction((): RewardClaimResult => {
        const previous = this.db
          .prepare("SELECT reward_id rewardId FROM reward_claims WHERE player_id=? AND idempotency_key=?")
          .get(playerId, requestId) as { rewardId: string } | undefined;
        if (previous) {
          if (previous.rewardId !== reward.id)
            throw new BantamError(
              "idempotency-conflict",
              "Idempotency key was already used for a different reward claim",
              409,
            );
          return {
            rewardId: reward.id,
            wallet: this.getWallet(playerId),
            inventory: this.getInventory(playerId),
            replayed: true,
          };
        }
        const maxClaims = reward.maxClaims ?? 1;
        if (this.countRewardClaims(playerId, reward.id) >= maxClaims)
          throw new BantamError(
            "reward-limit",
            "This reward has already been claimed the maximum times",
            409,
          );
        this.applyGrants(playerId, reward.grants, catalog, "reward_claim", `reward:${requestId}`, now);
        this.db
          .prepare(
            "INSERT INTO reward_claims(player_id, reward_id, idempotency_key, created_at) VALUES(?,?,?,?)",
          )
          .run(playerId, reward.id, requestId, now);
        return {
          rewardId: reward.id,
          wallet: this.getWallet(playerId),
          inventory: this.getInventory(playerId),
          replayed: false,
        };
      })
      .immediate();
  }

  getIapPurchase(provider: string, purchaseTokenHash: string): IapPurchaseRow | undefined {
    return this.db
      .prepare(
        `SELECT id, player_id playerId, provider, product_id productId,
          provider_product_id providerProductId, purchase_token_hash purchaseTokenHash,
          order_id orderId, verification_state verificationState, fulfillment_state fulfillmentState,
          acknowledge_state acknowledgeState, created_at createdAt, updated_at updatedAt
        FROM iap_purchases WHERE provider=? AND purchase_token_hash=?`,
      )
      .get(provider, purchaseTokenHash) as IapPurchaseRow | undefined;
  }

  listIapPurchases(playerId: string, limit = 100): IapPurchaseRow[] {
    this.assertLimit(limit);
    return this.db
      .prepare(
        `SELECT id, player_id playerId, provider, product_id productId,
          provider_product_id providerProductId, purchase_token_hash purchaseTokenHash,
          order_id orderId, verification_state verificationState, fulfillment_state fulfillmentState,
          acknowledge_state acknowledgeState, created_at createdAt, updated_at updatedAt
        FROM iap_purchases WHERE player_id=? ORDER BY id DESC LIMIT ?`,
      )
      .all(playerId, limit) as IapPurchaseRow[];
  }

  fulfillIap(args: {
    playerId: string;
    product: EconomyIapProduct;
    catalog: EconomyCatalog;
    purchaseTokenHash: string;
    orderId: string;
    now: number;
  }): IapFulfillmentResult {
    this.assertPlayerId(args.playerId);
    this.assertTimestamp(args.now);
    return this.db
      .transaction((): IapFulfillmentResult => {
        const existing = this.getIapPurchase(args.product.provider, args.purchaseTokenHash);
        if (existing) {
          if (existing.playerId !== args.playerId)
            throw new BantamError("iap-conflict", "Purchase token is already bound to another player", 409);
          if (existing.productId !== args.product.id)
            throw new BantamError("iap-conflict", "Purchase token is already bound to another product", 409);
          if (existing.fulfillmentState === "fulfilled")
            return {
              purchase: existing,
              wallet: this.getWallet(args.playerId),
              inventory: this.getInventory(args.playerId),
              replayed: true,
            };
          if (existing.fulfillmentState === "skipped")
            throw new BantamError("iap-refunded", "Purchase was refunded or revoked before fulfillment", 409);
        }
        this.applyGrants(
          args.playerId,
          args.product.grants,
          args.catalog,
          "iap_grant",
          `iap:${args.purchaseTokenHash}`,
          args.now,
        );
        if (existing) {
          this.db
            .prepare(
              `UPDATE iap_purchases SET verification_state='verified', fulfillment_state='fulfilled',
                order_id=?, updated_at=? WHERE id=?`,
            )
            .run(args.orderId || null, args.now, existing.id);
        } else {
          this.db
            .prepare(
              `INSERT INTO iap_purchases(
                player_id, provider, product_id, provider_product_id, purchase_token_hash, order_id,
                verification_state, fulfillment_state, acknowledge_state, created_at, updated_at
              ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              args.playerId,
              args.product.provider,
              args.product.id,
              args.product.providerProductId,
              args.purchaseTokenHash,
              args.orderId || null,
              "verified",
              "fulfilled",
              "pending",
              args.now,
              args.now,
            );
        }
        const purchase = this.getIapPurchase(args.product.provider, args.purchaseTokenHash);
        if (!purchase) throw new BantamError("iap-write-failed", "IAP fulfillment was not recorded", 500);
        return {
          purchase,
          wallet: this.getWallet(args.playerId),
          inventory: this.getInventory(args.playerId),
          replayed: false,
        };
      })
      .immediate();
  }

  recordSkippedIap(args: {
    playerId: string;
    product: EconomyIapProduct;
    purchaseTokenHash: string;
    orderId: string;
    verificationState: "refunded" | "revoked" | "invalid";
    now: number;
  }): IapPurchaseRow {
    this.assertPlayerId(args.playerId);
    this.assertTimestamp(args.now);
    const existing = this.getIapPurchase(args.product.provider, args.purchaseTokenHash);
    if (existing) {
      if (existing.playerId !== args.playerId)
        throw new BantamError("iap-conflict", "Purchase token is already bound to another player", 409);
      this.db
        .prepare(
          `UPDATE iap_purchases SET verification_state=?, fulfillment_state=CASE
            WHEN fulfillment_state='fulfilled' THEN fulfillment_state ELSE 'skipped' END,
            order_id=?, updated_at=? WHERE id=?`,
        )
        .run(args.verificationState, args.orderId || null, args.now, existing.id);
    } else {
      this.db
        .prepare(
          `INSERT INTO iap_purchases(
            player_id, provider, product_id, provider_product_id, purchase_token_hash, order_id,
            verification_state, fulfillment_state, acknowledge_state, created_at, updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          args.playerId,
          args.product.provider,
          args.product.id,
          args.product.providerProductId,
          args.purchaseTokenHash,
          args.orderId || null,
          args.verificationState,
          "skipped",
          "pending",
          args.now,
          args.now,
        );
    }
    const row = this.getIapPurchase(args.product.provider, args.purchaseTokenHash);
    if (!row) throw new BantamError("iap-write-failed", "IAP record was not saved", 500);
    return row;
  }

  markIapAcknowledged(provider: string, purchaseTokenHash: string, now: number, ok: boolean): void {
    this.db
      .prepare(
        `UPDATE iap_purchases SET acknowledge_state=?, updated_at=?
        WHERE provider=? AND purchase_token_hash=?`,
      )
      .run(ok ? "acknowledged" : "failed", now, provider, purchaseTokenHash);
  }

  private applyGrants(
    playerId: string,
    grants: readonly EconomyGrant[],
    catalog: EconomyCatalog,
    reason: string,
    keyPrefix: string,
    now: number,
  ): void {
    for (const grant of grants) {
      if (grant.kind === "currency") {
        this.creditCurrency(
          playerId,
          grant.currencyId,
          grant.amount,
          reason,
          `${keyPrefix}:${grant.currencyId}`,
          now,
        );
      } else {
        this.grantItem(
          playerId,
          catalogItem(catalog, grant.itemId),
          grant.quantity,
          reason,
          `${keyPrefix}:${grant.itemId}`,
          now,
        );
      }
    }
  }

  private mutateInventory(
    playerId: string,
    item: EconomyItem,
    delta: number,
    reason: string,
    idempotencyKey: string,
    now: number,
  ): InventoryMutationResult {
    this.assertPlayerId(playerId);
    this.assertReason(reason);
    this.assertIdempotencyKey(idempotencyKey);
    this.assertTimestamp(now);
    if (!Number.isSafeInteger(delta) || delta === 0)
      throw new BantamError("invalid-amount", "Item quantity must be a non-zero safe integer", 400);

    return this.db
      .transaction((): InventoryMutationResult => {
        const player = this.db.prepare("SELECT 1 FROM players WHERE id=?").get(playerId);
        if (!player) throw new BantamError("player-not-found", "Player not found", 404);
        const previous = this.db
          .prepare(
            `SELECT id, item_id itemId, amount, reason, quantity_after quantityAfter
            FROM inventory_transactions WHERE player_id=? AND idempotency_key=?`,
          )
          .get(playerId, idempotencyKey) as
          | { id: number; itemId: string; amount: number; reason: string; quantityAfter: number }
          | undefined;
        if (previous) {
          if (previous.itemId !== item.id || previous.amount !== delta || previous.reason !== reason)
            throw new BantamError(
              "idempotency-conflict",
              "Idempotency key was already used for a different inventory operation",
              409,
            );
          return { quantity: previous.quantityAfter, transactionId: previous.id, replayed: true };
        }

        const current = this.inventoryQuantity(playerId, item.id);
        if (delta < 0 && current < -delta)
          throw new BantamError("insufficient-item", "Insufficient item quantity", 409);
        if (item.type === "permanent" && delta > 0 && current > 0)
          throw new BantamError("already-owned", "This item is already owned", 409);
        if (item.type === "permanent" && delta > 1)
          throw new BantamError("invalid-amount", "Permanent items can only be granted once", 400);
        if (!item.stackable && delta > 1)
          throw new BantamError("invalid-amount", "This item cannot be stacked", 400);
        const next = current + delta;
        if (!Number.isSafeInteger(next) || next < 0)
          throw new BantamError(
            "balance-overflow",
            "Item quantity would exceed the supported integer range",
            409,
          );

        this.db
          .prepare(
            `INSERT INTO inventory(player_id, item_id, quantity, created_at, updated_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(player_id, item_id) DO UPDATE SET
              quantity=excluded.quantity, updated_at=excluded.updated_at`,
          )
          .run(playerId, item.id, next, now, now);
        const inserted = this.db
          .prepare(
            `INSERT INTO inventory_transactions(
              player_id, item_id, amount, reason, idempotency_key, quantity_after, created_at
            ) VALUES(?,?,?,?,?,?,?)`,
          )
          .run(playerId, item.id, delta, reason, idempotencyKey, next, now);
        return { quantity: next, transactionId: Number(inserted.lastInsertRowid), replayed: false };
      })
      .immediate();
  }

  private inventoryQuantity(playerId: string, itemId: string): number {
    const row = this.db
      .prepare("SELECT quantity FROM inventory WHERE player_id=? AND item_id=?")
      .get(playerId, itemId) as { quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  private walletTransaction(id: number): { id: number; balanceAfter: number } {
    const row = this.db
      .prepare("SELECT id, balance_after balanceAfter FROM wallet_transactions WHERE id=?")
      .get(id) as { id: number; balanceAfter: number } | undefined;
    if (!row) throw new BantamError("wallet-transaction-missing", "Wallet transaction was not found", 500);
    return row;
  }

  private assertPlayerId(playerId: string): void {
    if (!playerId || playerId.length > 128)
      throw new BantamError(
        "invalid-player",
        "Player id is required and must be at most 128 characters",
        400,
      );
  }

  private assertReason(reason: string): void {
    if (!/^[a-z][a-z0-9_.:-]{0,63}$/.test(reason))
      throw new BantamError("invalid-reason", "Transaction reason has an invalid format", 400);
  }

  private assertIdempotencyKey(idempotencyKey: string): void {
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
  }

  private assertTimestamp(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0)
      throw new BantamError("invalid-timestamp", "Timestamp must be a non-negative safe integer", 400);
  }

  private assertLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new BantamError("invalid-limit", "Limit must be an integer from 1 to 500", 400);
  }
}
