import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig, type LoadedConfig } from "../src/config.js";
import type { RuntimeGame } from "../src/types.js";
import type { EconomyCatalog } from "../src/services/economy.js";
import type { IapVerification, IapVerifier } from "../src/services/iap.js";
import { BantamClient } from "../packages/sdk/src/index.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function temp(): string {
  const value = mkdtempSync(join(tmpdir(), "bantam-economy-api-"));
  roots.push(value);
  return value;
}

const secret = "test-secret-that-is-long-enough-000001";
const catalog: EconomyCatalog = {
  currencies: [{ id: "coins" }],
  items: [
    { id: "extra_life", type: "consumable", stackable: true, usable: true },
    { id: "gold_skin", type: "permanent", stackable: false },
  ],
  offers: [
    {
      id: "life_pack",
      itemId: "extra_life",
      quantity: 2,
      priceCurrencyId: "coins",
      priceAmount: 40,
      active: true,
    },
  ],
  rewards: [{ id: "starter_pack", grants: [{ kind: "currency", currencyId: "coins", amount: 80 }] }],
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

function game(id = "demo"): RuntimeGame {
  return {
    id,
    displayName: id,
    adapters: [
      {
        kind: "generic",
        boards: [{ id: "high_score", direction: "higher", period: "all_time" }],
      },
    ],
    secretPrefix: "TEST",
    gracePeriodHours: 24,
    authProvider: "development",
    identitySalt: secret + id,
    sessionSecret: secret + id,
    cursorSecret: secret + id,
    economy: catalog,
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

async function adminCookie(app: import("fastify").FastifyInstance): Promise<string> {
  const reg = await app.inject({
    method: "POST",
    url: "/admin/register",
    payload: "username=alice&password=test-admin-password-ok&confirm=test-admin-password-ok",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  return reg.headers["set-cookie"]!.toString().split(";")[0]!;
}

class MemoryStorage {
  private readonly data = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

class FakeIapVerifier implements IapVerifier {
  acknowledgements = 0;
  constructor(private readonly result: IapVerification) {}
  async verify(): Promise<IapVerification> {
    return this.result;
  }
  async acknowledge(): Promise<void> {
    this.acknowledgements += 1;
  }
}

describe("economy HTTP and SDK", () => {
  it("loads the demo manifest catalog without requiring IAP secrets", () => {
    process.env.BANTAM_GAME_DEMO_IDENTITY_SALT = "test-identity-salt-32-chars-long";
    process.env.BANTAM_GAME_DEMO_SESSION_SECRET = "test-session-secret-32-chars-long";
    process.env.BANTAM_GAME_DEMO_CURSOR_SECRET = "test-cursor-secret-32-chars-long";
    process.env.BANTAM_GAME_ECHO_IDENTITY_SALT = "test-identity-salt-32-chars-long";
    process.env.BANTAM_GAME_ECHO_SESSION_SECRET = "test-session-secret-32-chars-long";
    process.env.BANTAM_GAME_ECHO_CURSOR_SECRET = "test-cursor-secret-32-chars-long";
    try {
      const loaded = loadConfig(join(process.cwd(), "config/games.demo.json"));
      expect(loaded.games.get("demo")?.economy?.offers[0]?.id).toBe("life_pack");
      expect(loaded.games.get("demo")?.economy?.iapProducts).toBeUndefined();
    } finally {
      delete process.env.BANTAM_GAME_DEMO_IDENTITY_SALT;
      delete process.env.BANTAM_GAME_DEMO_SESSION_SECRET;
      delete process.env.BANTAM_GAME_DEMO_CURSOR_SECRET;
      delete process.env.BANTAM_GAME_ECHO_IDENTITY_SALT;
      delete process.env.BANTAM_GAME_ECHO_SESSION_SECRET;
      delete process.env.BANTAM_GAME_ECHO_CURSOR_SECRET;
    }
  });

  it("requires a session and keeps prices server-authoritative", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      expect((await app.inject({ method: "GET", url: "/v1/games/demo/economy/wallet" })).statusCode).toBe(
        401,
      );
      const login = await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "shopper" },
      });
      const token = login.json<{ accessToken: string }>().accessToken;
      const auth = { authorization: `Bearer ${token}` };
      expect(
        (await app.inject({ method: "GET", url: "/v1/games/demo/economy/wallet", headers: auth })).json(),
      ).toEqual({ balances: [] });
      const store = await app.inject({ method: "GET", url: "/v1/games/demo/economy/store", headers: auth });
      expect(store.json()).toEqual({
        offers: [
          {
            id: "life_pack",
            itemId: "extra_life",
            quantity: 2,
            priceCurrencyId: "coins",
            priceAmount: 40,
            remainingPurchases: null,
          },
        ],
      });
      const forged = await app.inject({
        method: "POST",
        url: "/v1/games/demo/economy/purchases",
        headers: auth,
        payload: { offerId: "life_pack", requestId: "buy-1", priceAmount: 1 },
      });
      expect(forged.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("claims a starter reward, buys an offer, uses the item, and exposes the same surface on the SDK", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "sdk-player" },
      });
      const session = login.json<{ accessToken: string; refreshToken: string; expiresIn: number }>();
      const storage = new MemoryStorage();
      await storage.set(
        "bantam:demo:session",
        JSON.stringify({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresIn: session.expiresIn,
          expiresAt: Date.now() + session.expiresIn * 1000,
        }),
      );
      const client = new BantamClient({
        baseUrl: "http://economy.test",
        gameId: "demo",
        storage,
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const headers: Record<string, string> = {};
          if (init?.headers) {
            const raw = new Headers(init.headers);
            raw.forEach((headerValue, key) => {
              headers[key] = headerValue;
            });
          }
          const response = await app.inject({
            method: (init?.method as "GET" | "POST") ?? "GET",
            url: `${url.pathname}${url.search}`,
            headers,
            ...(init?.body ? { payload: String(init.body) } : {}),
          });
          return new Response(response.body, {
            status: response.statusCode,
            headers: { "content-type": "application/json" },
          });
        },
      });

      const claimed = await client.claimReward("starter_pack", "claim-1");
      expect(claimed.wallet).toEqual([{ currencyId: "coins", balance: 80 }]);
      expect((await client.claimReward("starter_pack", "claim-1")).replayed).toBe(true);
      const second = await app.inject({
        method: "POST",
        url: "/v1/games/demo/economy/rewards/claim",
        headers: { authorization: `Bearer ${session.accessToken}` },
        payload: { rewardId: "starter_pack", requestId: "claim-2" },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ error: { code: "reward-limit" } });

      const bought = await client.purchaseItem("life_pack", "buy-1");
      expect(bought).toMatchObject({
        itemId: "extra_life",
        quantity: 2,
        quantityAfter: 2,
        wallet: { currencyId: "coins", balance: 40 },
        replayed: false,
      });
      expect((await client.purchaseItem("life_pack", "buy-1")).replayed).toBe(true);
      expect(await client.getInventory()).toEqual({ items: [{ itemId: "extra_life", quantity: 2 }] });
      const used = await client.useItem("extra_life", "use-1");
      expect(used).toEqual({
        itemId: "extra_life",
        consumedQuantity: 1,
        quantityAfter: 1,
        replayed: false,
      });
      expect(await client.getWallet()).toEqual({ balances: [{ currencyId: "coins", balance: 40 }] });
    } finally {
      await app.close();
    }
  }, 30_000);

  it("verifies IAP through the injected provider and never grants a refunded token", async () => {
    const purchased: IapVerification = {
      provider: "google_play",
      productId: "coins_100",
      orderId: "GPA.1",
      purchaseState: "purchased",
      acknowledged: false,
      consumptionState: "yet_to_be_consumed",
    };
    const verifier = new FakeIapVerifier(purchased);
    const app = await buildApp(config(), {
      logger: false,
      iapVerifierFactory: () => verifier,
    });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "iap-player" },
      });
      const token = login.json<{ accessToken: string }>().accessToken;
      const auth = { authorization: `Bearer ${token}` };
      const first = await app.inject({
        method: "POST",
        url: "/v1/games/demo/economy/iap",
        headers: auth,
        payload: { purchaseToken: "play-token-1", productId: "coins_100" },
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({
        productId: "coins_100",
        fulfillmentState: "fulfilled",
        acknowledgeState: "acknowledged",
        replayed: false,
        wallet: [{ currencyId: "coins", balance: 100 }],
      });
      expect(verifier.acknowledgements).toBe(1);
      const replay = await app.inject({
        method: "POST",
        url: "/v1/games/demo/economy/iap",
        headers: auth,
        payload: { purchaseToken: "play-token-1", productId: "coins_100" },
      });
      expect(replay.json()).toMatchObject({
        replayed: true,
        wallet: [{ currencyId: "coins", balance: 100 }],
      });

      const refunded = new FakeIapVerifier({ ...purchased, purchaseState: "canceled", orderId: "GPA.2" });
      await app.close();
      const refundApp = await buildApp(config(), {
        logger: false,
        iapVerifierFactory: () => refunded,
      });
      try {
        const refundLogin = await refundApp.inject({
          method: "POST",
          url: "/v1/games/demo/auth/exchange",
          payload: { authorizationCode: "iap-refund" },
        });
        const refundToken = refundLogin.json<{ accessToken: string }>().accessToken;
        const denied = await refundApp.inject({
          method: "POST",
          url: "/v1/games/demo/economy/iap",
          headers: { authorization: `Bearer ${refundToken}` },
          payload: { purchaseToken: "play-token-2", productId: "coins_100" },
        });
        expect(denied.statusCode).toBe(409);
        expect(denied.json()).toMatchObject({ error: { code: "iap-refunded" } });
        const wallet = await refundApp.inject({
          method: "GET",
          url: "/v1/games/demo/economy/wallet",
          headers: { authorization: `Bearer ${refundToken}` },
        });
        expect(wallet.json()).toEqual({ balances: [] });
      } finally {
        await refundApp.close();
      }
    } finally {
      await app.close().catch(() => undefined);
    }
  }, 30_000);

  it("returns 503 when IAP products exist but no verifier is configured", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "no-verifier" },
      });
      const denied = await app.inject({
        method: "POST",
        url: "/v1/games/demo/economy/iap",
        headers: { authorization: `Bearer ${login.json<{ accessToken: string }>().accessToken}` },
        payload: { purchaseToken: "play-token-3", productId: "coins_100" },
      });
      expect(denied.statusCode).toBe(503);
      expect(denied.json()).toMatchObject({ error: { code: "iap-not-configured" } });
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe("economy admin", () => {
  it("lets an operator inspect a player and apply audited currency and item adjustments", async () => {
    const app = await buildApp(config(), { logger: false });
    try {
      const cookie = await adminCookie(app);
      const login = await app.inject({
        method: "POST",
        url: "/v1/games/demo/auth/exchange",
        payload: { authorizationCode: "admin-target" },
      });
      const token = login.json<{ accessToken: string }>().accessToken;
      const player = (
        await app.inject({
          method: "GET",
          url: "/v1/games/demo/economy/wallet",
          headers: { authorization: `Bearer ${token}` },
        })
      ).headers;
      expect(player).toBeTruthy();
      const list = await app.inject({
        method: "GET",
        url: "/admin/games/demo/players",
        headers: { cookie },
      });
      const idMatch = list.body.match(/\/admin\/games\/demo\/players\/(p_[0-9a-f]+)/);
      expect(idMatch).toBeTruthy();
      const playerId = decodeURIComponent(idMatch![1]!);
      const credit = await app.inject({
        method: "POST",
        url: `/admin/games/demo/players/${encodeURIComponent(playerId)}/currency`,
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        payload: "currencyId=coins&amount=25&direction=credit&requestId=admin-credit-1",
      });
      expect(credit.statusCode).toBe(302);
      expect(String(credit.headers["location"])).not.toContain("error=");
      const grant = await app.inject({
        method: "POST",
        url: `/admin/games/demo/players/${encodeURIComponent(playerId)}/item`,
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        payload: "itemId=extra_life&quantity=2&direction=grant&requestId=admin-item-1",
      });
      expect(grant.statusCode).toBe(302);
      const page = await app.inject({
        method: "GET",
        url: `/admin/games/demo/players/${encodeURIComponent(playerId)}`,
        headers: { cookie },
      });
      expect(page.statusCode).toBe(200);
      expect(page.body).toMatch(/coins/);
      expect(page.body).toMatch(/25/);
      expect(page.body).toMatch(/extra_life/);
      expect(page.body).toMatch(/admin_adjustment/);
      expect(page.body).not.toMatch(/play-token/);

      const unauth = await app.inject({
        method: "POST",
        url: `/admin/games/demo/players/${encodeURIComponent(playerId)}/currency`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "currencyId=coins&amount=1&direction=credit&requestId=sneaky",
      });
      expect(unauth.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  }, 30_000);
});
