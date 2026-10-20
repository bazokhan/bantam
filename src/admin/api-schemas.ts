import { Type, type Static } from "@sinclair/typebox";

// The economy catalog contract is defined by the service layer, not by the
// admin API. Re-exported here so the console can derive its types from the
// same schemas the server validates against.
export {
  CurrencyGrantSchema,
  EconomyCatalogSchema,
  EconomyCurrencySchema,
  EconomyGrantSchema,
  EconomyIapProductSchema,
  EconomyItemSchema,
  EconomyOfferSchema,
  EconomyRewardSchema,
  ItemGrantSchema,
} from "../services/economy.js";

// Wire schemas for the admin JSON API. These are the contract the React
// console codes against (packages/admin-ui/src/lib/types.ts). Request bodies
// are strict — unknown input is rejected. Responses are strict too, so a
// server-side change that drops or renames a field fails loudly here instead
// of silently degrading the console.

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInteger = Type.Union([Type.Integer(), Type.Null()]);

// Mirrors the manifest contract in src/config.ts. Keeping the response
// schemas as tight as the manifest means the console's derived types are
// exact, and an out-of-contract value fails loudly instead of flowing on.
const AuthProviderSchema = Type.Union([Type.Literal("pgs-v2"), Type.Literal("development")]);
const EnvironmentSchema = Type.Union([
  Type.Literal("development"),
  Type.Literal("test"),
  Type.Literal("production"),
]);

export const EnvKeyStatusSchema = Type.Object(
  { name: Type.String(), present: Type.Boolean() },
  { additionalProperties: false },
);

export const BoardSummarySchema = Type.Object(
  { id: Type.String(), period: Type.String(), entries: Type.Number() },
  { additionalProperties: false },
);

export const AdapterSummarySchema = Type.Object(
  {
    id: Type.String(),
    kind: Type.String(),
    version: NullableString,
    boards: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export const GameSummarySchema = Type.Object(
  {
    id: Type.String(),
    displayName: Type.String(),
    authProvider: AuthProviderSchema,
    secretPrefix: NullableString,
    adapterCount: Type.Number(),
    boards: Type.Array(BoardSummarySchema),
    players: Type.Number(),
    flags: Type.Number(),
    runsToday: Type.Number(),
    lastRunAt: NullableString,
    dbReady: Type.Boolean(),
    envKeys: Type.Array(EnvKeyStatusSchema),
  },
  { additionalProperties: false },
);

export const GameDetailSchema = Type.Object(
  {
    ...GameSummarySchema.properties,
    gracePeriodHours: Type.Number(),
    environment: EnvironmentSchema,
    adapters: Type.Array(AdapterSummarySchema),
  },
  { additionalProperties: false },
);

export const SessionResponseSchema = Type.Object(
  {
    admin: Type.Union([
      Type.Object(
        {
          id: Type.String(),
          username: Type.String(),
          createdAt: NullableString,
          lastLoginAt: NullableString,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    firstRun: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const LeaderboardEntrySchema = Type.Object(
  {
    rank: Type.Number(),
    playerId: Type.String(),
    displayName: Type.String(),
    value: Type.Number(),
    updatedAt: NullableString,
  },
  { additionalProperties: false },
);

// One board and period a single player appears on.
export const PlayerEntrySchema = Type.Object(
  {
    boardId: Type.String(),
    period: Type.String(),
    rank: Type.Number(),
    value: Type.Number(),
    achievedAt: NullableString,
    runId: Type.String(),
  },
  { additionalProperties: false },
);

export const PlayerEntriesResponseSchema = Type.Object(
  {
    playerId: Type.String(),
    entries: Type.Array(PlayerEntrySchema),
    total: Type.Number(),
  },
  { additionalProperties: false },
);

export const BoardEntriesResponseSchema = Type.Object(
  {
    boardId: Type.String(),
    period: Type.String(),
    periods: Type.Array(Type.String()),
    entries: Type.Array(LeaderboardEntrySchema),
  },
  { additionalProperties: false },
);

export const PlayerSummarySchema = Type.Object(
  {
    id: Type.String(),
    displayName: Type.String(),
    provider: AuthProviderSchema,
    createdAt: NullableString,
    runs: Type.Number(),
  },
  { additionalProperties: false },
);

export const PlayersResponseSchema = Type.Object(
  { players: Type.Array(PlayerSummarySchema), total: Type.Number() },
  { additionalProperties: false },
);

export const WalletBalanceSchema = Type.Object(
  { currency: Type.String(), amount: Type.Number() },
  { additionalProperties: false },
);

export const LedgerEntrySchema = Type.Object(
  {
    id: Type.String(),
    playerId: Type.String(),
    currency: Type.String(),
    amount: Type.Number(),
    balance: Type.Number(),
    reason: Type.String(),
    createdAt: NullableString,
  },
  { additionalProperties: false },
);

export const InventoryItemSchema = Type.Object(
  { item: Type.String(), quantity: Type.Number() },
  { additionalProperties: false },
);

export const InventoryTransactionSchema = Type.Object(
  {
    id: Type.String(),
    item: Type.String(),
    amount: Type.Number(),
    balance: Type.Number(),
    reason: Type.String(),
    createdAt: NullableString,
  },
  { additionalProperties: false },
);

export const PurchaseRowSchema = Type.Object(
  {
    id: Type.String(),
    offerId: Type.String(),
    itemId: Type.String(),
    quantity: Type.Number(),
    currencyId: Type.String(),
    priceAmount: Type.Number(),
    createdAt: NullableString,
  },
  { additionalProperties: false },
);

export const IapPurchaseRowSchema = Type.Object(
  {
    id: Type.String(),
    provider: Type.String(),
    productId: Type.String(),
    providerProductId: Type.String(),
    verificationState: Type.String(),
    fulfillmentState: Type.String(),
    acknowledgeState: Type.String(),
    createdAt: NullableString,
  },
  { additionalProperties: false },
);

// How many times a player has claimed one reward, against that reward's limit.
export const PlayerRewardClaimSchema = Type.Object(
  {
    rewardId: Type.String(),
    claims: Type.Integer(),
    maxClaims: Type.Integer(),
  },
  { additionalProperties: false },
);

export const PlayerDetailSchema = Type.Object(
  {
    id: Type.String(),
    displayName: Type.String(),
    provider: AuthProviderSchema,
    createdAt: NullableString,
    wallet: Type.Array(WalletBalanceSchema),
    ledger: Type.Array(LedgerEntrySchema),
    inventory: Type.Array(InventoryItemSchema),
    inventoryLedger: Type.Array(InventoryTransactionSchema),
    purchases: Type.Array(PurchaseRowSchema),
    iapPurchases: Type.Array(IapPurchaseRowSchema),
    rewardClaims: Type.Array(PlayerRewardClaimSchema),
    runs: Type.Number(),
  },
  { additionalProperties: false },
);

export const RunSummarySchema = Type.Object(
  {
    id: Type.String(),
    boardId: Type.String(),
    period: Type.String(),
    value: Type.Number(),
    createdAt: NullableString,
    playerId: Type.String(),
    displayName: Type.String(),
  },
  { additionalProperties: false },
);

export const RunsResponseSchema = Type.Object(
  { runs: Type.Array(RunSummarySchema), total: Type.Number() },
  { additionalProperties: false },
);

export const FeatureFlagRowSchema = Type.Object(
  {
    key: Type.String(),
    enabled: Type.Boolean(),
    description: Type.String(),
    targeting: Type.String(),
    updatedAt: NullableString,
    environment: EnvironmentSchema,
  },
  { additionalProperties: false },
);

export const FlagsResponseSchema = Type.Object(
  { flags: Type.Array(FeatureFlagRowSchema) },
  { additionalProperties: false },
);

export const EconomySummarySchema = Type.Object(
  {
    currencies: Type.Array(
      Type.Object(
        { id: Type.String(), amount: Type.Number(), holders: Type.Number() },
        { additionalProperties: false },
      ),
    ),
    items: Type.Array(
      Type.Object(
        { id: Type.String(), quantity: Type.Number(), holders: Type.Number() },
        { additionalProperties: false },
      ),
    ),
    walletTransactions: Type.Object(
      { today: Type.Number(), total: Type.Number() },
      { additionalProperties: false },
    ),
    inventoryTransactions: Type.Object(
      { today: Type.Number(), total: Type.Number() },
      { additionalProperties: false },
    ),
    playersWithBalance: Type.Number(),
  },
  { additionalProperties: false },
);

// One grant inside a reward or an IAP product. The catalog stores currency
// grants as {kind,currencyId,amount} and item grants as {kind,itemId,quantity};
// the response flattens both into one shape so the console renders a single
// table and does not have to branch on a union at every call site.
export const EconomyGrantRowSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("currency"), Type.Literal("item")]),
    currencyId: Type.Optional(Type.String()),
    itemId: Type.Optional(Type.String()),
    amount: Type.Optional(Type.Integer()),
    quantity: Type.Optional(Type.Integer()),
  },
  { additionalProperties: false },
);

export const EconomyOfferRowSchema = Type.Object(
  {
    id: Type.String(),
    itemId: Type.String(),
    quantity: Type.Integer(),
    priceCurrencyId: Type.String(),
    priceAmount: Type.Integer(),
    active: Type.Boolean(),
    maxPerPlayer: NullableInteger,
    startsAtMs: NullableInteger,
    endsAtMs: NullableInteger,
    salePriceAmount: NullableInteger,
    saleStartsAtMs: NullableInteger,
    saleEndsAtMs: NullableInteger,
  },
  { additionalProperties: false },
);

export const EconomyRewardRowSchema = Type.Object(
  {
    id: Type.String(),
    grants: Type.Array(EconomyGrantRowSchema),
    maxClaims: NullableInteger,
  },
  { additionalProperties: false },
);

export const EconomyIapProductRowSchema = Type.Object(
  {
    id: Type.String(),
    provider: Type.String(),
    providerProductId: Type.String(),
    packageName: Type.String(),
    grants: Type.Array(EconomyGrantRowSchema),
    active: Type.Boolean(),
    startsAtMs: NullableInteger,
    endsAtMs: NullableInteger,
    fulfillment: Type.Union([Type.Literal("consumable"), Type.Literal("permanent"), Type.Null()]),
  },
  { additionalProperties: false },
);

// The full economy catalog of one game, plus the live balance summary. Every
// field the console can edit is present here: the catalog round-trips through
// the economy write endpoint unchanged.
export const EconomyResponseSchema = Type.Object(
  {
    currencies: Type.Array(Type.Object({ id: Type.String() }, { additionalProperties: false })),
    items: Type.Array(
      Type.Object(
        { id: Type.String(), type: Type.String(), stackable: Type.Boolean(), usable: Type.Boolean() },
        { additionalProperties: false },
      ),
    ),
    offers: Type.Array(EconomyOfferRowSchema),
    rewards: Type.Array(EconomyRewardRowSchema),
    iapProducts: Type.Array(EconomyIapProductRowSchema),
    summary: EconomySummarySchema,
  },
  { additionalProperties: false },
);

export const HealthResponseSchema = Type.Object(
  {
    status: Type.Union([Type.Literal("ok"), Type.Literal("degraded")]),
    environment: EnvironmentSchema,
    allowedOrigins: Type.Array(Type.String()),
    games: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          displayName: Type.String(),
          declaredAdapters: Type.Number(),
          loadedAdapters: Type.Number(),
          dbReady: Type.Boolean(),
          envComplete: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
    uptimeSeconds: Type.Number(),
    version: Type.String(),
  },
  { additionalProperties: false },
);

export const ManifestResponseSchema = Type.Object(
  {
    manifest: Type.Record(Type.String(), Type.Unknown()),
    environment: EnvironmentSchema,
  },
  { additionalProperties: false },
);

export const ActivityPointSchema = Type.Object(
  { date: Type.String(), players: Type.Number(), runs: Type.Number() },
  { additionalProperties: false },
);

export const OverviewResponseSchema = Type.Object(
  {
    generatedAt: Type.String(),
    totals: Type.Object(
      {
        games: Type.Number(),
        players: Type.Number(),
        runsToday: Type.Number(),
        flags: Type.Number(),
        boards: Type.Number(),
      },
      { additionalProperties: false },
    ),
    games: Type.Array(GameSummarySchema),
    activity: Type.Array(ActivityPointSchema),
    recentRuns: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          boardId: Type.String(),
          period: Type.String(),
          value: Type.Number(),
          createdAt: NullableString,
          playerId: Type.String(),
          displayName: Type.String(),
          gameId: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const AdaptersResponseSchema = Type.Object(
  {
    adapters: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          kind: Type.Union([Type.Literal("file"), Type.Literal("generic")]),
          version: NullableString,
          source: NullableString,
          boards: Type.Array(Type.String()),
          games: Type.Array(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

// One operator action, newest first. `details` is a JSON object the server
// builds itself; it never carries credentials, tokens or raw provider ids.
export const AuditEntrySchema = Type.Object(
  {
    id: Type.String(),
    adminId: NullableString,
    adminUsername: Type.String(),
    action: Type.String(),
    gameId: NullableString,
    target: NullableString,
    details: Type.String(),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);

export const AuditResponseSchema = Type.Object(
  { entries: Type.Array(AuditEntrySchema), total: Type.Number() },
  { additionalProperties: false },
);

// Result of an operator-initiated reward claim.
export const RewardClaimResponseSchema = Type.Object(
  {
    rewardId: Type.String(),
    replayed: Type.Boolean(),
    claims: Type.Integer(),
    maxClaims: Type.Integer(),
    wallet: Type.Array(WalletBalanceSchema),
    inventory: Type.Array(InventoryItemSchema),
  },
  { additionalProperties: false },
);

// The module behind a loaded adapter. Read-only: adapters ship from a sibling
// repository and the runtime imports them at boot, so the console can show
// what is running but never rewrite it.
export const AdapterSourceSchema = Type.Object(
  {
    id: Type.String(),
    file: Type.String(),
    language: Type.Literal("javascript"),
    bytes: Type.Integer(),
    content: Type.String(),
    editable: Type.Boolean(),
  },
  { additionalProperties: false },
);

// The editable identity fields of one game in the manifest.
export const GameSettingsResponseSchema = Type.Object(
  {
    id: Type.String(),
    displayName: Type.String(),
    authProvider: AuthProviderSchema,
    gracePeriodHours: Type.Integer(),
    secretPrefix: Type.String(),
    environment: EnvironmentSchema,
  },
  { additionalProperties: false },
);

// ─── Request bodies ──────────────────────────────────────────────────────────
export const FlagWriteBodySchema = Type.Object(
  {
    enabled: Type.Boolean(),
    description: Type.Optional(Type.String({ maxLength: 200 })),
    targeting: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

export const ManifestWriteBodySchema = Type.Object(
  { manifest: Type.Record(Type.String(), Type.Unknown()) },
  { additionalProperties: false },
);

// The whole economy catalog of one game. Strict: unknown keys are rejected,
// so a typo in a console field is an error instead of a silently dropped value.
export const EconomyCatalogWriteBodySchema = Type.Object(
  {
    currencies: Type.Array(
      Type.Object(
        { id: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }) },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 16 },
    ),
    items: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
          type: Type.Union([Type.Literal("consumable"), Type.Literal("permanent")]),
          stackable: Type.Boolean(),
          usable: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 256 },
    ),
    offers: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
          itemId: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
          quantity: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
          priceCurrencyId: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
          priceAmount: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
          active: Type.Optional(Type.Boolean()),
          maxPerPlayer: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
          startsAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
          endsAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
          salePriceAmount: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
          saleStartsAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
          saleEndsAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
    rewards: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
            grants: Type.Array(
              Type.Union([
                Type.Object(
                  {
                    kind: Type.Literal("currency"),
                    currencyId: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
                    amount: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
                  },
                  { additionalProperties: false },
                ),
                Type.Object(
                  {
                    kind: Type.Literal("item"),
                    itemId: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
                    quantity: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
                  },
                  { additionalProperties: false },
                ),
              ]),
              { minItems: 1, maxItems: 16 },
            ),
            maxClaims: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
          },
          { additionalProperties: false },
        ),
        { maxItems: 64 },
      ),
    ),
    iapProducts: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
            provider: Type.Literal("google_play"),
            providerProductId: Type.String({ pattern: "^[A-Za-z0-9._~-]{1,128}$" }),
            packageName: Type.String({
              pattern: "^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$",
              maxLength: 255,
            }),
            grants: Type.Array(
              Type.Union([
                Type.Object(
                  {
                    kind: Type.Literal("currency"),
                    currencyId: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
                    amount: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
                  },
                  { additionalProperties: false },
                ),
                Type.Object(
                  {
                    kind: Type.Literal("item"),
                    itemId: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,47}$" }),
                    quantity: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
                  },
                  { additionalProperties: false },
                ),
              ]),
              { minItems: 1, maxItems: 16 },
            ),
            active: Type.Optional(Type.Boolean()),
            startsAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
            endsAtMs: Type.Optional(Type.Integer({ minimum: 0 })),
            fulfillment: Type.Optional(Type.Union([Type.Literal("consumable"), Type.Literal("permanent")])),
          },
          { additionalProperties: false },
        ),
        { maxItems: 64 },
      ),
    ),
  },
  { additionalProperties: false },
);

// The editable identity fields of one game. The game id and the secret prefix
// are deliberately absent: both are bound to data that cannot be moved from
// the console (the id is the database path, the prefix names env variables).
export const GameSettingsWriteBodySchema = Type.Object(
  {
    displayName: Type.String({ minLength: 1, maxLength: 80 }),
    authProvider: Type.Union([Type.Literal("pgs-v2"), Type.Literal("development")]),
    gracePeriodHours: Type.Integer({ minimum: 0, maximum: 168 }),
  },
  { additionalProperties: false },
);

export const RewardClaimBodySchema = Type.Object(
  {
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

export const EmptyBodySchema = Type.Object({}, { additionalProperties: false });

export type FlagWriteBody = Static<typeof FlagWriteBodySchema>;
export type ManifestWriteBody = Static<typeof ManifestWriteBodySchema>;
export type EconomyCatalogWriteBody = Static<typeof EconomyCatalogWriteBodySchema>;
export type GameSettingsWriteBody = Static<typeof GameSettingsWriteBodySchema>;
export type RewardClaimBody = Static<typeof RewardClaimBodySchema>;
export type EmptyBody = Static<typeof EmptyBodySchema>;
export type SessionResponse = Static<typeof SessionResponseSchema>;
export type GameSummaryResponse = Static<typeof GameSummarySchema>;
export type GameDetailResponse = Static<typeof GameDetailSchema>;
export type OverviewResponse = Static<typeof OverviewResponseSchema>;
export type HealthResponse = Static<typeof HealthResponseSchema>;
export type ManifestResponse = Static<typeof ManifestResponseSchema>;
export type BoardEntriesResponse = Static<typeof BoardEntriesResponseSchema>;
export type PlayersResponse = Static<typeof PlayersResponseSchema>;
export type PlayerDetailResponse = Static<typeof PlayerDetailSchema>;
export type RunsResponse = Static<typeof RunsResponseSchema>;
export type FlagsResponse = Static<typeof FlagsResponseSchema>;
export type FeatureFlagResponse = Static<typeof FeatureFlagRowSchema>;
export type EconomyResponse = Static<typeof EconomyResponseSchema>;
export type AdaptersResponse = Static<typeof AdaptersResponseSchema>;
export type LeaderboardEntryResponse = Static<typeof LeaderboardEntrySchema>;
export type RunSummaryResponse = Static<typeof RunSummarySchema>;
export type EconomyGrantRow = Static<typeof EconomyGrantRowSchema>;
export type EconomyOfferRow = Static<typeof EconomyOfferRowSchema>;
export type EconomyRewardRow = Static<typeof EconomyRewardRowSchema>;
export type EconomyIapProductRow = Static<typeof EconomyIapProductRowSchema>;
export type PlayerRewardClaim = Static<typeof PlayerRewardClaimSchema>;
export type RewardClaimResponse = Static<typeof RewardClaimResponseSchema>;
export type AdapterSourceResponse = Static<typeof AdapterSourceSchema>;
export type GameSettingsResponse = Static<typeof GameSettingsResponseSchema>;
