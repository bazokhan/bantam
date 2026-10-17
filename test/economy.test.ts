import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { GameDatabase } from "../src/db/game-database.js";
import { BantamError } from "../src/errors.js";
import {
  parseEconomyCatalog,
  type EconomyCatalog,
  type EconomyItem,
  type EconomyOffer,
} from "../src/services/economy.js";
import {
  GooglePlayIapVerifier,
  hashPurchaseToken,
  parseGooglePlayServiceAccount,
} from "../src/services/iap.js";

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
      expect(credit).toMatchObject({ balance: 250, replayed: false });
      expect(credit.transactionId).toBeGreaterThan(0);
      const debit = db.debitCurrency("player-1", "coins", 75, "test_spend", "spend-1", 3_000);
      expect(debit).toMatchObject({ balance: 175, replayed: false });
      expect(debit.transactionId).toBeGreaterThan(0);
      db.creditCurrency("player-1", "gems", 3, "mission_reward", "gems-1", 4_000);

      expect(db.getWallet("player-1")).toEqual([
        { currencyId: "coins", balance: 175 },
        { currencyId: "gems", balance: 3 },
      ]);
      expect(
        db.listWalletTransactions("player-1").map((row) => ({
          currencyId: row.currencyId,
          amount: row.amount,
          reason: row.reason,
          balanceAfter: row.balanceAfter,
        })),
      ).toEqual([
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
      expect(
        errorCode(() => db.creditCurrency("player-1", "coins", 101, "mission_reward", "same-key", 3_000)),
      ).toBe("idempotency-conflict");
      expect(
        errorCode(() => db.debitCurrency("player-1", "coins", 100, "test_spend", "same-key", 3_000)),
      ).toBe("idempotency-conflict");
      expect(
        errorCode(() => db.creditCurrency("player-1", "gems", 100, "mission_reward", "same-key", 3_000)),
      ).toBe("idempotency-conflict");
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
        expect(
          errorCode(() => db.creditCurrency("player-1", "coins", amount, "mission_reward", "key", 2_000)),
        ).toBe("invalid-amount");
        expect(
          errorCode(() => db.debitCurrency("player-1", "coins", amount, "test_spend", "key", 2_000)),
        ).toBe("invalid-amount");
      }
      expect(errorCode(() => db.creditCurrency("player-1", "Coins", 1, "mission_reward", "key", 2_000))).toBe(
        "invalid-currency",
      );
      expect(errorCode(() => db.creditCurrency("player-1", "coins", 1, "Bad Reason", "key", 2_000))).toBe(
        "invalid-reason",
      );
      expect(
        errorCode(() => db.creditCurrency("player-1", "coins", 1, "mission_reward", " key", 2_000)),
      ).toBe("invalid-idempotency-key");
      expect(errorCode(() => db.creditCurrency("player-1", "coins", 1, "mission_reward", "key", -1))).toBe(
        "invalid-timestamp",
      );
      expect(
        errorCode(() => db.creditCurrency("missing-player", "coins", 1, "mission_reward", "key", 2_000)),
      ).toBe("player-not-found");
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
      expect(errorCode(() => db.debitCurrency("player-1", "coins", 1, "test_spend", "too-much", 2_000))).toBe(
        "insufficient-funds",
      );
      expect(db.getWallet("player-1")).toEqual([]);
      expect(db.listWalletTransactions("player-1")).toEqual([]);

      db.creditCurrency("player-1", "coins", Number.MAX_SAFE_INTEGER, "admin_adjustment", "max", 3_000);
      expect(
        errorCode(() => db.creditCurrency("player-1", "coins", 1, "mission_reward", "overflow", 4_000)),
      ).toBe("balance-overflow");
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
      expect(
        errorCode(() => second.debitCurrency("player-1", "coins", 40, "test_spend", "spend-b", 4_000)),
      ).toBe("insufficient-funds");
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
      expect(db.getInventory("player-1")).toEqual([]);
      expect(db.listStorePurchases("player-1")).toEqual([]);
      expect(db.listIapPurchases("player-1")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("upgrades an existing database without changing players, flags, runs, or leaderboard behavior", () => {
    const root = temp();
    const oldMigrations = join(root, "old-migrations");
    cpSync(join(process.cwd(), "migrations"), oldMigrations, { recursive: true });
    rmSync(join(oldMigrations, "004_economy.sql"));
    rmSync(join(oldMigrations, "005_economy_shop.sql"));
    const path = join(root, "game.sqlite");
    const oldDb = new GameDatabase(path, oldMigrations);
    try {
      oldDb.upsertPlayer("legacy-player", "development", "Legacy Player", 1_000);
      oldDb.upsertFlag(
        {
          key: "existing_flag",
          description: "existing",
          enabled: true,
          rolloutPercent: 100,
          value: "on",
        },
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
      expect(upgraded.getPlayer("legacy-player")).toEqual({
        id: "legacy-player",
        displayName: "Legacy Player",
      });
      expect(upgraded.listFlags().map((flag) => flag.key)).toEqual(["existing_flag"]);
      expect(
        upgraded.list({ id: "score", direction: "higher", period: "all_time" }, "all_time", 0, 10),
      ).toMatchObject([{ displayName: "Legacy Player", value: 42, rank: 1 }]);
      expect(upgraded.getWallet("legacy-player")).toEqual([]);
      expect(
        upgraded.creditCurrency("legacy-player", "coins", 5, "mission_reward", "new-reward", 2_000).balance,
      ).toBe(5);
      expect(
        upgraded.db.prepare("SELECT version FROM schema_migrations ORDER BY version").pluck().all(),
      ).toEqual([1, 2, 3, 4, 5]);
      expect(upgraded.integrity()).toEqual(["ok"]);
    } finally {
      upgraded.close();
    }

    const inspection = new Database(path);
    try {
      expect(inspection.prepare("SELECT count(*) FROM runs").pluck().get()).toBe(1);
      expect(inspection.prepare("SELECT count(*) FROM wallet_transactions").pluck().get()).toBe(1);
      expect(inspection.prepare("SELECT count(*) FROM inventory").pluck().get()).toBe(0);
    } finally {
      inspection.close();
    }
  });
});

const catalog: EconomyCatalog = {
  currencies: [{ id: "coins" }],
  items: [
    { id: "extra_life", type: "consumable", stackable: true, usable: true },
    { id: "gold_skin", type: "permanent", stackable: false },
    { id: "trophy", type: "permanent", stackable: false, usable: true },
  ],
  offers: [
    {
      id: "life_pack",
      itemId: "extra_life",
      quantity: 3,
      priceCurrencyId: "coins",
      priceAmount: 50,
      active: true,
    },
    {
      id: "skin_offer",
      itemId: "gold_skin",
      quantity: 1,
      priceCurrencyId: "coins",
      priceAmount: 80,
      active: true,
    },
    {
      id: "inactive_life",
      itemId: "extra_life",
      quantity: 1,
      priceCurrencyId: "coins",
      priceAmount: 10,
      active: false,
    },
    {
      id: "limited_life",
      itemId: "extra_life",
      quantity: 1,
      priceCurrencyId: "coins",
      priceAmount: 20,
      maxPerPlayer: 1,
    },
  ],
  rewards: [
    {
      id: "starter_pack",
      grants: [{ kind: "currency", currencyId: "coins", amount: 100 }],
      maxClaims: 1,
    },
  ],
  iapProducts: [
    {
      id: "coins_100",
      provider: "google_play",
      providerProductId: "coins_100",
      packageName: "com.example.game",
      grants: [{ kind: "currency", currencyId: "coins", amount: 100 }],
    },
  ],
};

function offer(id: string): EconomyOffer {
  return catalog.offers.find((row) => row.id === id)!;
}
function item(id: string): EconomyItem {
  return catalog.items.find((row) => row.id === id)!;
}

describe("economy catalog", () => {
  it("rejects unknown fields, duplicate ids, and broken references", () => {
    expect(() => parseEconomyCatalog({ currencies: [], items: [], offers: [] }, "/economy")).toThrow(
      BantamError,
    );
    expect(() =>
      parseEconomyCatalog({ ...catalog, items: [...catalog.items, catalog.items[0]!] }, "/economy"),
    ).toThrow("duplicate item");
    expect(() =>
      parseEconomyCatalog({ ...catalog, offers: [{ ...offer("life_pack"), itemId: "missing" }] }, "/economy"),
    ).toThrow("unknown item");
    expect(() =>
      parseEconomyCatalog(
        {
          ...catalog,
          items: [{ id: "gold_skin", type: "permanent", stackable: true }],
        },
        "/economy",
      ),
    ).toThrow("cannot be stackable");
    expect(parseEconomyCatalog(undefined, "/economy")).toBeUndefined();
    expect(parseEconomyCatalog(catalog, "/economy")).toMatchObject({ currencies: [{ id: "coins" }] });
  });
});

describe("inventory and virtual shop", () => {
  it("purchases with the catalog price, grants items, and records a ledger debit", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      db.creditCurrency("player-1", "coins", 200, "admin_adjustment", "seed", 2_000);
      const bought = db.purchaseOffer("player-1", offer("life_pack"), item("extra_life"), "buy-1", 3_000);
      expect(bought).toMatchObject({
        itemId: "extra_life",
        quantity: 3,
        quantityAfter: 3,
        replayed: false,
        wallet: { balance: 150, replayed: false },
      });
      expect(db.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: 150 }]);
      expect(db.getInventory("player-1")).toEqual([{ itemId: "extra_life", quantity: 3 }]);
      expect(db.listWalletTransactions("player-1")[0]).toMatchObject({
        amount: -50,
        reason: "item_purchase",
      });
    } finally {
      db.close();
    }
  });

  it("replays an identical purchase without charging or granting twice", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      db.creditCurrency("player-1", "coins", 200, "admin_adjustment", "seed", 2_000);
      const first = db.purchaseOffer("player-1", offer("life_pack"), item("extra_life"), "buy-1", 3_000);
      const replay = db.purchaseOffer("player-1", offer("life_pack"), item("extra_life"), "buy-1", 4_000);
      expect(replay).toMatchObject({
        purchaseId: first.purchaseId,
        replayed: true,
        quantityAfter: 3,
        wallet: { balance: 150, replayed: true },
      });
      expect(db.getInventory("player-1")).toEqual([{ itemId: "extra_life", quantity: 3 }]);
      expect(db.listStorePurchases("player-1")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects a reused purchase key, inactive offers, insufficient funds, and second permanent copies", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      db.creditCurrency("player-1", "coins", 10, "admin_adjustment", "seed-low", 1_500);
      expect(
        errorCode(() => db.purchaseOffer("player-1", offer("inactive_life"), item("extra_life"), "x", 3_000)),
      ).toBe("offer-inactive");
      expect(
        errorCode(() => db.purchaseOffer("player-1", offer("life_pack"), item("extra_life"), "broke", 3_000)),
      ).toBe("insufficient-funds");
      db.creditCurrency("player-1", "coins", 190, "admin_adjustment", "seed", 2_000);
      db.purchaseOffer("player-1", offer("life_pack"), item("extra_life"), "buy-life", 3_000);
      expect(
        errorCode(() =>
          db.purchaseOffer("player-1", offer("skin_offer"), item("gold_skin"), "buy-life", 4_000),
        ),
      ).toBe("idempotency-conflict");
      db.purchaseOffer("player-1", offer("skin_offer"), item("gold_skin"), "buy-skin", 4_000);
      expect(
        errorCode(() =>
          db.purchaseOffer("player-1", offer("skin_offer"), item("gold_skin"), "buy-skin-2", 5_000),
        ),
      ).toBe("already-owned");
      expect(db.getInventory("player-1")).toEqual([
        { itemId: "extra_life", quantity: 3 },
        { itemId: "gold_skin", quantity: 1 },
      ]);
    } finally {
      db.close();
    }
  });

  it("enforces maxPerPlayer and rolls back when inventory grant fails", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      db.creditCurrency("player-1", "coins", 200, "admin_adjustment", "seed", 2_000);
      db.purchaseOffer("player-1", offer("limited_life"), item("extra_life"), "once", 3_000);
      expect(
        errorCode(() =>
          db.purchaseOffer("player-1", offer("limited_life"), item("extra_life"), "twice", 4_000),
        ),
      ).toBe("offer-limit");
      expect(db.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: 180 }]);

      db.db.exec(`CREATE TRIGGER reject_inventory
        BEFORE INSERT ON inventory_transactions
        BEGIN SELECT RAISE(ABORT, 'inventory blocked'); END;`);
      expect(() =>
        db.purchaseOffer("player-1", offer("life_pack"), item("extra_life"), "rollback", 5_000),
      ).toThrow("inventory blocked");
      expect(db.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: 180 }]);
      expect(db.listStorePurchases("player-1")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("uses consumables by decrementing quantity and records permanent uses without consuming", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      db.grantItem("player-1", item("extra_life"), 2, "admin_adjustment", "give-life", 2_000);
      db.grantItem("player-1", item("trophy"), 1, "admin_adjustment", "give-trophy", 2_100);
      const used = db.useItem("player-1", item("extra_life"), "use-1", 3_000);
      expect(used).toEqual({
        itemId: "extra_life",
        consumedQuantity: 1,
        quantityAfter: 1,
        replayed: false,
      });
      expect(db.useItem("player-1", item("extra_life"), "use-1", 4_000).replayed).toBe(true);
      expect(db.useItem("player-1", item("trophy"), "use-trophy", 5_000)).toEqual({
        itemId: "trophy",
        consumedQuantity: 0,
        quantityAfter: 1,
        replayed: false,
      });
      expect(db.getInventory("player-1")).toEqual([
        { itemId: "extra_life", quantity: 1 },
        { itemId: "trophy", quantity: 1 },
      ]);
      expect(errorCode(() => db.useItem("player-1", item("gold_skin"), "nope", 6_000))).toBe(
        "item-not-usable",
      );
    } finally {
      db.close();
    }
  });

  it("claims a catalog reward once and rejects a second distinct claim", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      const first = db.claimReward("player-1", catalog.rewards![0]!, catalog, "claim-1", 2_000);
      expect(first.wallet).toEqual([{ currencyId: "coins", balance: 100 }]);
      expect(db.claimReward("player-1", catalog.rewards![0]!, catalog, "claim-1", 3_000).replayed).toBe(true);
      expect(
        errorCode(() => db.claimReward("player-1", catalog.rewards![0]!, catalog, "claim-2", 4_000)),
      ).toBe("reward-limit");
      expect(db.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: 100 }]);
    } finally {
      db.close();
    }
  });

  it("prevents two connections from buying the last remaining limited offer twice", () => {
    const root = temp();
    const first = openDb(root);
    const second = openDb(root);
    try {
      addPlayer(first);
      first.creditCurrency("player-1", "coins", 200, "admin_adjustment", "seed", 2_000);
      first.purchaseOffer("player-1", offer("limited_life"), item("extra_life"), "a", 3_000);
      expect(
        errorCode(() =>
          second.purchaseOffer("player-1", offer("limited_life"), item("extra_life"), "b", 4_000),
        ),
      ).toBe("offer-limit");
    } finally {
      first.close();
      second.close();
    }
  });
});

describe("google play IAP fulfillment", () => {
  it("fulfills a verified token once and replays the same hash", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      const tokenHash = hashPurchaseToken("google_play", "token-1");
      const first = db.fulfillIap({
        playerId: "player-1",
        product: catalog.iapProducts![0]!,
        catalog,
        purchaseTokenHash: tokenHash,
        orderId: "GPA.1",
        now: 2_000,
      });
      expect(first.wallet).toEqual([{ currencyId: "coins", balance: 100 }]);
      expect(first.purchase.fulfillmentState).toBe("fulfilled");
      const replay = db.fulfillIap({
        playerId: "player-1",
        product: catalog.iapProducts![0]!,
        catalog,
        purchaseTokenHash: tokenHash,
        orderId: "GPA.1",
        now: 3_000,
      });
      expect(replay.replayed).toBe(true);
      expect(db.getWallet("player-1")).toEqual([{ currencyId: "coins", balance: 100 }]);
      expect(db.listIapPurchases("player-1")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("skips fulfillment for refunded tokens and refuses to bind a token to a second player", () => {
    const db = openDb(temp());
    try {
      addPlayer(db);
      addPlayer(db, "player-2");
      const tokenHash = hashPurchaseToken("google_play", "token-2");
      const skipped = db.recordSkippedIap({
        playerId: "player-1",
        product: catalog.iapProducts![0]!,
        purchaseTokenHash: tokenHash,
        orderId: "GPA.2",
        verificationState: "refunded",
        now: 2_000,
      });
      expect(skipped.fulfillmentState).toBe("skipped");
      expect(
        errorCode(() =>
          db.fulfillIap({
            playerId: "player-1",
            product: catalog.iapProducts![0]!,
            catalog,
            purchaseTokenHash: tokenHash,
            orderId: "GPA.2",
            now: 3_000,
          }),
        ),
      ).toBe("iap-refunded");
      expect(db.getWallet("player-1")).toEqual([]);
      db.fulfillIap({
        playerId: "player-1",
        product: catalog.iapProducts![0]!,
        catalog,
        purchaseTokenHash: hashPurchaseToken("google_play", "token-3"),
        orderId: "GPA.3",
        now: 4_000,
      });
      expect(
        errorCode(() =>
          db.fulfillIap({
            playerId: "player-2",
            product: catalog.iapProducts![0]!,
            catalog,
            purchaseTokenHash: hashPurchaseToken("google_play", "token-3"),
            orderId: "GPA.3",
            now: 5_000,
          }),
        ),
      ).toBe("iap-conflict");
    } finally {
      db.close();
    }
  });

  it("rejects a malformed service-account secret and hashes tokens distinctly", () => {
    expect(hashPurchaseToken("google_play", "a")).not.toBe(hashPurchaseToken("google_play", "b"));
    expect(() => parseGooglePlayServiceAccount("{", "TEST_KEY")).toThrow("Invalid JSON");
    expect(() => parseGooglePlayServiceAccount("{}", "TEST_KEY")).toThrow("client_email");
    expect(() =>
      parseGooglePlayServiceAccount(
        JSON.stringify({ client_email: "svc@example.com", private_key: "not-a-key" }),
        "TEST_KEY",
      ),
    ).toThrow("private_key");
  });

  it("maps Google Play purchase payloads and acknowledges through the injected fetch", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const calls: string[] = [];
    const verifier = new GooglePlayIapVerifier(
      parseGooglePlayServiceAccount(
        JSON.stringify({ client_email: "svc@example.iam.gserviceaccount.com", private_key: pem }),
        "TEST_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
      ),
      async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (String(url).includes("oauth2")) {
          return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 });
        }
        if (String(url).includes(":acknowledge")) return new Response("{}", { status: 200 });
        return new Response(
          JSON.stringify({
            purchaseState: 0,
            acknowledgementState: 0,
            consumptionState: 0,
            orderId: "GPA.9",
          }),
          { status: 200 },
        );
      },
    );
    const verified = await verifier.verify({
      packageName: "com.example.game",
      productId: "coins_100",
      purchaseToken: "token",
    });
    expect(verified).toMatchObject({ purchaseState: "purchased", orderId: "GPA.9", acknowledged: false });
    await verifier.acknowledge({
      packageName: "com.example.game",
      productId: "coins_100",
      purchaseToken: "token",
    });
    expect(calls.some((call) => call.includes(":acknowledge"))).toBe(true);
    expect(calls.some((call) => call.includes("oauth2"))).toBe(true);
  });
});
