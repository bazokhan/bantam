export type Session = { accessToken: string; refreshToken: string; expiresIn: number; expiresAt: number };
export type AuthResult =
  | { status: "authenticated"; session: Session; displayName: string }
  | { status: "cancelled" | "unavailable"; reason?: string };
export type LeaderboardEntry = { displayName: string; value: number; rank: number };
export type FeatureFlag = { key: string; enabled: boolean; value: string | null };
export type WalletBalance = { currencyId: string; balance: number };
export type InventoryItem = { itemId: string; quantity: number };
export type StoreOffer = {
  id: string;
  itemId: string;
  quantity: number;
  priceCurrencyId: string;
  priceAmount: number;
  remainingPurchases: number | null;
};
export type PurchaseResult = {
  purchaseId: number;
  itemId: string;
  quantity: number;
  quantityAfter: number;
  wallet: WalletBalance;
  replayed: boolean;
};
export type UseItemResult = {
  itemId: string;
  consumedQuantity: number;
  quantityAfter: number;
  replayed: boolean;
};
export type ClaimRewardResult = {
  rewardId: string;
  wallet: WalletBalance[];
  inventory: InventoryItem[];
  replayed: boolean;
};
export type IapSubmitResult = {
  productId: string;
  fulfillmentState: string;
  acknowledgeState: string;
  wallet: WalletBalance[];
  inventory: InventoryItem[];
  replayed: boolean;
};
export type CandidateValue = {
  boardId: string;
  periodKey: string;
  value: number;
  direction: "higher" | "lower";
};
export type QueuedRun = {
  gameId: string;
  adapterId: string;
  runId: string;
  payload: Record<string, unknown>;
  candidates: CandidateValue[];
  expiresAt?: number;
};

export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class BrowserStorage implements KeyValueStorage {
  constructor(private readonly storage: Storage = globalThis.localStorage) {}
  async get(key: string): Promise<string | null> {
    return this.storage.getItem(key);
  }
  async set(key: string, value: string): Promise<void> {
    this.storage.setItem(key, value);
  }
  async remove(key: string): Promise<void> {
    this.storage.removeItem(key);
  }
}

export class BantamApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BantamApiError";
  }
}

type ClientOptions = {
  baseUrl: string;
  gameId: string;
  storage: KeyValueStorage;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export class BantamClient {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly sessionKey: string;
  private readonly queueKey: string;
  constructor(private readonly options: ClientOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.sessionKey = `bantam:${options.gameId}:session`;
    this.queueKey = `bantam:${options.gameId}:queue`;
  }

  async optionalLogin(getServerAuthCode: () => Promise<string | null>): Promise<AuthResult> {
    let code: string | null;
    try {
      code = await getServerAuthCode();
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "authentication unavailable",
      };
    }
    if (!code) return { status: "cancelled" };
    try {
      const response = await this.request<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        player: { displayName: string };
      }>("/auth/exchange", { method: "POST", body: { authorizationCode: code }, auth: false });
      const session = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresIn: response.expiresIn,
        expiresAt: Date.now() + response.expiresIn * 1000,
      };
      await this.options.storage.set(this.sessionKey, JSON.stringify(session));
      await this.flushQueue();
      return { status: "authenticated", session, displayName: response.player.displayName };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "authentication unavailable",
      };
    }
  }

  async logout(): Promise<void> {
    const session = await this.loadSession();
    if (session) {
      try {
        await this.request("/auth/logout", {
          method: "POST",
          body: { refreshToken: session.refreshToken },
          auth: false,
        });
      } catch {
        /* Local logout still succeeds. */
      }
    }
    await this.options.storage.remove(this.sessionKey);
  }

  async queueBest(run: QueuedRun): Promise<void> {
    const queue = await this.loadQueue();
    for (const candidate of run.candidates) {
      const key = `${run.adapterId}:${candidate.boardId}:${candidate.periodKey}`;
      const current = queue[key];
      if (!current) queue[key] = run;
      else {
        const old = current.candidates.find(
          (value) => value.boardId === candidate.boardId && value.periodKey === candidate.periodKey,
        );
        if (
          !old ||
          (candidate.direction === "higher" ? candidate.value > old.value : candidate.value < old.value)
        )
          queue[key] = run;
      }
    }
    await this.saveQueue(queue);
    await this.flushQueue();
  }

  async flushQueue(): Promise<void> {
    const queue = await this.loadQueue();
    const unique = new Map(Object.values(queue).map((run) => [`${run.adapterId}:${run.runId}`, run]));
    for (const run of unique.values()) {
      if (run.expiresAt && Date.now() > run.expiresAt) {
        removeRun(queue, run);
        continue;
      }
      try {
        await this.request(`/runs/${encodeURIComponent(run.adapterId)}`, {
          method: "POST",
          body: { runId: run.runId, payload: run.payload },
        });
        removeRun(queue, run);
      } catch (error) {
        if (
          error instanceof BantamApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          ![401, 429].includes(error.status)
        )
          removeRun(queue, run);
        else break;
      }
    }
    await this.saveQueue(queue);
  }

  async leaderboard(
    boardId: string,
    options: { period?: string; cursor?: string; limit?: number } = {},
  ): Promise<{ entries: LeaderboardEntry[]; nextCursor: string | null }> {
    return this.request(`/leaderboards/${encodeURIComponent(boardId)}${query(options)}`);
  }
  async myRank(boardId: string, period?: string): Promise<{ entry: LeaderboardEntry | null }> {
    return this.request(`/leaderboards/${encodeURIComponent(boardId)}/me${query({ period })}`);
  }
  async aroundMe(boardId: string, period?: string, radius = 3): Promise<{ entries: LeaderboardEntry[] }> {
    return this.request(`/leaderboards/${encodeURIComponent(boardId)}/around-me${query({ period, radius })}`);
  }
  async deleteMyData(): Promise<void> {
    await this.request("/player", { method: "DELETE" });
    await this.options.storage.remove(this.sessionKey);
    await this.options.storage.remove(this.queueKey);
  }

  // Read-only. Sends the session when one exists so partial rollouts resolve
  // per player; signed-out callers still receive fully-rolled-out flags.
  // `isEnabled` returns `fallback` when the key is missing or the read fails.
  async getFlags(): Promise<FeatureFlag[]> {
    const response = await this.request<{ flags: FeatureFlag[] }>("/flags");
    return response.flags;
  }

  async isEnabled(key: string, fallback = false): Promise<boolean> {
    try {
      const flag = (await this.getFlags()).find((item) => item.key === key);
      return flag ? flag.enabled : fallback;
    } catch {
      return fallback;
    }
  }

  async getWallet(): Promise<{ balances: WalletBalance[] }> {
    return this.request("/economy/wallet");
  }
  async getInventory(): Promise<{ items: InventoryItem[] }> {
    return this.request("/economy/inventory");
  }
  async getStore(): Promise<{ offers: StoreOffer[] }> {
    return this.request("/economy/store");
  }
  async purchaseItem(offerId: string, requestId: string): Promise<PurchaseResult> {
    return this.request("/economy/purchases", { method: "POST", body: { offerId, requestId } });
  }
  async useItem(itemId: string, requestId: string): Promise<UseItemResult> {
    return this.request("/economy/items/use", { method: "POST", body: { itemId, requestId } });
  }
  async claimReward(rewardId: string, requestId: string): Promise<ClaimRewardResult> {
    return this.request("/economy/rewards/claim", { method: "POST", body: { rewardId, requestId } });
  }
  async submitIapPurchase(purchaseToken: string, productId: string): Promise<IapSubmitResult> {
    return this.request("/economy/iap", {
      method: "POST",
      body: { purchaseToken, productId, provider: "google_play" },
    });
  }

  private async request<T = void>(
    path: string,
    options: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const execute = async (retry: boolean): Promise<T> => {
      const session = options.auth === false ? null : await this.validSession();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetcher(
          `${this.options.baseUrl.replace(/\/$/, "")}/v1/games/${encodeURIComponent(this.options.gameId)}${path}`,
          {
            method: options.method ?? "GET",
            headers: {
              ...(options.body ? { "content-type": "application/json" } : {}),
              ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
            },
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
            signal: controller.signal,
          },
        );
        if (response.status === 401 && retry && options.auth !== false && (await this.refresh()))
          return execute(false);
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string };
          };
          throw new BantamApiError(
            data.error?.code ?? "request-failed",
            data.error?.message ?? "Bantam request failed",
            response.status,
          );
        }
        return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
      } finally {
        clearTimeout(timeout);
      }
    };
    return execute(true);
  }

  private async validSession(): Promise<Session | null> {
    const value = await this.loadSession();
    if (!value) return null;
    if (value.expiresAt - Date.now() < 30_000) return (await this.refresh()) ? this.loadSession() : null;
    return value;
  }
  private async refresh(): Promise<boolean> {
    const current = await this.loadSession();
    if (!current) return false;
    try {
      const response = await this.request<{ accessToken: string; refreshToken: string; expiresIn: number }>(
        "/auth/refresh",
        { method: "POST", body: { refreshToken: current.refreshToken }, auth: false },
      );
      await this.options.storage.set(
        this.sessionKey,
        JSON.stringify({ ...response, expiresAt: Date.now() + response.expiresIn * 1000 }),
      );
      return true;
    } catch {
      await this.options.storage.remove(this.sessionKey);
      return false;
    }
  }
  private async loadSession(): Promise<Session | null> {
    try {
      const raw = await this.options.storage.get(this.sessionKey);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }
  private async loadQueue(): Promise<Record<string, QueuedRun>> {
    try {
      const raw = await this.options.storage.get(this.queueKey);
      return raw ? (JSON.parse(raw) as Record<string, QueuedRun>) : {};
    } catch {
      return {};
    }
  }
  private async saveQueue(queue: Record<string, QueuedRun>): Promise<void> {
    if (Object.keys(queue).length) await this.options.storage.set(this.queueKey, JSON.stringify(queue));
    else await this.options.storage.remove(this.queueKey);
  }
}

function removeRun(queue: Record<string, QueuedRun>, run: QueuedRun): void {
  for (const [key, value] of Object.entries(queue))
    if (value.adapterId === run.adapterId && value.runId === run.runId) delete queue[key];
}
function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}
