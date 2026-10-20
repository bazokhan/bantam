import { Type, type Static } from "@sinclair/typebox";

// Wire schemas for the admin JSON API. These are the contract the React
// console codes against (packages/admin-ui/src/lib/types.ts). Request bodies
// are strict — unknown input is rejected. Responses are strict too, so a
// server-side change that drops or renames a field fails loudly here instead
// of silently degrading the console.

const NullableString = Type.Union([Type.String(), Type.Null()]);

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

export const EconomyResponseSchema = Type.Object(
  {
    currencies: Type.Array(Type.Object({ id: Type.String() }, { additionalProperties: false })),
    items: Type.Array(
      Type.Object(
        { id: Type.String(), type: Type.String(), stackable: Type.Boolean(), usable: Type.Boolean() },
        { additionalProperties: false },
      ),
    ),
    offers: Type.Array(
      Type.Object(
        {
          id: Type.String(),
          itemId: Type.String(),
          quantity: Type.Number(),
          priceCurrencyId: Type.String(),
          priceAmount: Type.Number(),
          active: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
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
          kind: Type.String(),
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

export const EmptyBodySchema = Type.Object({}, { additionalProperties: false });

export type FlagWriteBody = Static<typeof FlagWriteBodySchema>;
export type ManifestWriteBody = Static<typeof ManifestWriteBodySchema>;
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
