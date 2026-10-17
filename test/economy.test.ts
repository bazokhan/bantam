import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { GameDatabase } from "../src/db/game-database.js";
import { BantamError } from "../src/errors.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp(): string {
  const root = mkdtempSync(join(tmpdir(), "bantam-economy-test-"));
  roots.push(root);
  return root;
}

function openDb(root: string, migrations = join(process.cwd(), "migrations")): GameDatabase {
  return new GameDatabase(join(root, "game.sqlite"), migrations);
}

function addPlayer(db: GameDatabase, id = "player-1"): void {
  db.upsertPlayer(id, "development", id, 1_000);
}

function errorCode(action: () => unknown): string {
  try {
    action();
    return "none";
  } catch (error) {
    return error instanceof BantamError ? error.code : "unknown";
  }
}

describe("economy foundation", () => {
  it("starts empty and records credits/debits as integer balances and ledger entries", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      expect(db.getWallet("player-1")).toEqual([]);

      const credit = db.creditCurrency("player-1", "coins", 250, "mission_reward", "reward-1", 2_000);
      expect(credit).toEqual({ balance: 250, transactionId: expect.any(Number), replayed: false });
      const debit = db.debitCurrency("player-1", "coins", 75, "test_spend", "spend-1", 3_000);
      expect(debit).toEqual({ balance: 175, transactionId: expect.any(Number), replayed: false });
      db.creditCurrency("player-1", "gems", 3, "mission_reward", "gems-1", 4_000);

      expect(db.getWallet("player-1")).toEqual([
        { currencyId: "coins", balance: 175 },
        { currencyId: "gems", balance: 3 },
      ]);
      expect(db.listWalletTransactions("player-1").map((row) => ({
        currencyId: row.currencyId,
        amount: row.amount,
        reason: row.reason,
        balanceAfter: row.balanceAfter,
      }))).toEqual([
        { currencyId: "gems", amount: 3, reason: "mission_reward", balanceAfter: 3 },
        { currencyId: "coins", amount: -75, reason: "test_spend", balanceAfter: 175 },
        { currencyId: "coins", amount: 250, reason: "mission_reward", balanceAfter: 250 },
      ]);
      expect(db.integrity()).toEqual(["ok"]);
    } finally {
      db.close();
    }
  });

  it("replays an identical idempotent operation without applying it twice", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      const original = db.creditCurrency("player-1", "coins", 100, "mission_reward", "reward-1", 2_000);
      db.creditCurrency("player-1", "coins", 20, "mission_reward", "reward-2", 3_000);

      const replay = db.creditCurrency("player-1", "coins", 100, "mission_reward", "reward-1", 9_000);
      expect(replay).toEqual({ ...original, replayed: true });
      expect(db.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: 120 }]);
      expect(db.listWalletTransactions("player-1")).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it("rejects reuse of an idempotency key for a different operation", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      db.creditCurrency("player-1", "coins", 100, "mission_reward", "same-key", 2_000);
      expect(errorCode(() => db.creditCurrency("player-1", "coins", 101, "mission_reward", "same-key", 3_000)))
        .toBe("idempotency-conflict");
      expect(errorCode(() => db.debitCurrency("player-1", "coins", 100, "test_spend", "same-key", 3_000)))
        .toBe("idempotency-conflict");
      expect(errorCode(() => db.creditCurrency("player-1", "gems", 100, "mission_reward", "same-key", 3_000)))
        .toBe("idempotency-conflict");
      expect(db.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: 100 }]);
      expect(db.listWalletTransactions("player-1")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects invalid amounts, currency identifiers, reasons, keys, timestamps, and missing players", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      for (const amount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(errorCode(() => db.creditCurrency("player-1", "coins", amount, "mission_reward", "key", 2_000)))
          .toBe("invalid-amount");
        expect(errorCode(() => db.debitCurrency("player-1", "coins", amount, "test_spend", "key", 2_000)))
          .toBe("invalid-amount");
      }
      expect(errorCode(() => db.creditCurrency("player-1", "Coins", 1, "mission_reward", "key", 2_000)))
        .toBe("invalid-currency");
      expect(errorCode(() => db.creditCurrency("player-1", "coins", 1, "Bad Reason", "key", 2_000)))
        .toBe("invalid-reason");
      expect(errorCode(() => db.creditCurrency("player-1", "coins", 1, "mission_reward", " key", 2_000)))
        .toBe("invalid-idempotency-key");
      expect(errorCode(() => db.creditCurrency("player-1", "coins", 1, "mission_reward", "key", -1)))
        .toBe("invalid-timestamp");
      expect(errorCode(() => db.creditCurrency("missing-player", "coins", 1, "mission_reward", "key", 2_000)))
        .toBe("player-not-found");
      expect(db.getWallet("player-1")).toEqual([]);
      expect(db.listWalletTransactions("player-1")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("does not allow overspending, negative balances, or balances outside safe integer range", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      expect(errorCode(() => db.debitCurrency("player-1", "coins", 1, "test_spend", "too-much", 2_000)))
        .toBe("insufficient-funds");
      expect(db.getWallet("player-1")).toEqual([]);
      expect(db.listWalletTransactions("player-1")).toEqual([]);

      db.creditCurrency("player-1", "coins", Number.MAX_SAFE_INTEGER, "admin_adjustment", "max", 3_000);
      expect(errorCode(() => db.creditCurrency("player-1", "coins", 1, "mission_reward", "overflow", 4_000)))
        .toBe("balance-overflow");
      expect(db.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: Number.MAX_SAFE_INTEGER }]);
      expect(db.listWalletTransactions("player-1")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rolls back a balance change if the ledger insert fails", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      db.db.exec(`CREATE TRIGGER reject_wallet_ledger
        BEFORE INSERT ON wallet_transactions
        BEGIN SELECT RAISE(ABORT, 'ledger blocked'); END;`);
      expect(() =>
        db.creditCurrency("player-1", "coins", 10, "mission_reward", "rollback-test", 2_000),
      ).toThrow("ledger blocked");
      expect(db.getWallet("player-1")).toEqual([]);
      expect(db.listWalletTransactions("player-1")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("shares balances across database connections and rejects a second spend that exceeds the remainder", () => {
    const root = temp();
    const first = openDb(root);
    const second = openDb(root);
    try {
      addPlayer(first);
      first.creditCurrency("player-1", "coins", 100, "mission_reward", "credit", 2_000);
      first.debitCurrency("player-1", "coins", 70, "test_spend", "spend-a", 3_000);
      expect(errorCode(() => second.debitCurrency("player-1", "coins", 40, "test_spend", "spend-b", 4_000)))
        .toBe("insufficient-funds");
      expect(first.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: 30 }]);
      expect(first.listWalletTransactions("player-1")).toHaveLength(2);
    } finally {
      first.close();
      second.close();
    }
  });

  it("cascades economy data when a player is deleted, preserving existing data-erasure semantics", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      db.creditCurrency("player-1", "coins", 10, "mission_reward", "reward", 2_000);
      expect(db.deletePlayer("player-1")).toBe(1);
      expect(db.getWallet("player-1")).toEqual([]);
      expect(db.listWalletTransactions("player-1")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("upgrades an existing database without changing players, flags, runs, or leaderboard behavior", () => {
    const root = temp();
    const oldMigrations = join(root, "old-migrations");
    cpSync(join(process.cwd(), "migrations"), oldMigrations, { recursive: true });
    rmSync(join(oldMigrations, "004_economy.sql"));
    const path = join(root, "game.sqlite");
    const oldDb = new GameDatabase(path, oldMigrations);
    try {
      oldDb.upsertPlayer("legacy-player", "development", "Legacy Player", 1_000);
      oldDb.upsertFlag(
        { key: "existing_flag", description: "existing", enabled: true, rolloutPercent: 100, value: "on" },
        1_100,
      );
      const board = { id: "score", direction: "higher" as const, period: "all_time" as const };
      oldDb.submitRun({
        adapterId: "legacy-adapter",
        playerId: "legacy-player",
        runId: "legacy-run",
        payloadHash: "legacy-payload",
        values: [{ boardId: "score", periodKey: "all_time", value: 42 }],
        boards: [board],
        response: { accepted: true },
        now: 1_200,
      });
    } finally {
      oldDb.close();
    }

    const upgraded = new GameDatabase(path, join(process.cwd(), "migrations"));
    try {
      expect(upgraded.getPlayer("legacy-player")).toEqual({ id: "legacy-player", displayName: "Legacy Player" });
      expect(upgraded.listFlags().map((flag) => flag.key)).toEqual(["existing_flag"]);
      expect(upgraded.list({ id: "score", direction: "higher", period: "all_time" }, "all_time", 0, 10))
        .toMatchObject([{ displayName: "Legacy Player", value: 42, rank: 1 }]);
      expect(upgraded.getWallet("legacy-player")).toEqual([]);
      expect(upgraded.creditCurrency("legacy-player", "coins", 5, "mission_reward", "new-reward", 2_000).balance)
        .toBe(5);
      expect(upgraded.db.prepare("SELECT version FROM schema_migrations ORDER BY version").pluck().all())
        .toEqual([1, 2, 3, 4]);
      expect(upgraded.integrity()).toEqual(["ok"]);
    } finally {
      upgraded.close();
    }

    const inspection = new Database(path);
    try {
      expect(inspection.prepare("SELECT count(*) FROM runs").pluck().get()).toBe(1);
      expect(inspection.prepare("SELECT count(*) FROM wallet_transactions").pluck().get()).toBe(1);
    } finally {
      inspection.close();
    }
  });
});
