/**
 * Wire contract for the admin JSON API.
 *
 * Every response type below is derived from the server's TypeBox schemas in
 * `src/admin/api-schemas.ts`, so a server-side rename or dropped field breaks
 * this package's typecheck instead of failing in the browser.
 */

import type { Static } from "@sinclair/typebox";

import type {
  ActivityPointSchema,
  AdapterSummarySchema,
  AdaptersResponseSchema,
  AuditEntrySchema,
  AuditResponseSchema,
  BoardEntriesResponseSchema,
  BoardSummarySchema,
  EconomyResponseSchema,
  EconomySummarySchema,
  EnvKeyStatusSchema,
  FeatureFlagRowSchema,
  FlagWriteBodySchema,
  FlagsResponseSchema,
  GameDetailSchema,
  GameSummarySchema,
  HealthResponseSchema,
  InventoryItemSchema,
  InventoryTransactionSchema,
  IapPurchaseRowSchema,
  LeaderboardEntrySchema,
  LedgerEntrySchema,
  ManifestResponseSchema,
  OverviewResponseSchema,
  PlayerDetailSchema,
  PlayerEntriesResponseSchema,
  PlayerEntrySchema,
  PlayersResponseSchema,
  PlayerSummarySchema,
  PurchaseRowSchema,
  RunSummarySchema,
  RunsResponseSchema,
  SessionResponseSchema,
  WalletBalanceSchema,
} from "@server/admin/api-schemas";

export type AuthProvider = Static<typeof GameSummarySchema>["authProvider"];
export type GameEnvironment = Static<typeof GameDetailSchema>["environment"];

export type AdminIdentity = NonNullable<Static<typeof SessionResponseSchema>["admin"]>;
export type SessionResponse = Static<typeof SessionResponseSchema>;
export type EnvKeyStatus = Static<typeof EnvKeyStatusSchema>;
export type BoardSummary = Static<typeof BoardSummarySchema>;
export type AdapterSummary = Static<typeof AdapterSummarySchema>;
export type GameSummary = Static<typeof GameSummarySchema>;
export type GameDetail = Static<typeof GameDetailSchema>;
export type LeaderboardEntry = Static<typeof LeaderboardEntrySchema>;
export type BoardEntriesResponse = Static<typeof BoardEntriesResponseSchema>;
export type PlayerSummary = Static<typeof PlayerSummarySchema>;
export type PlayersResponse = Static<typeof PlayersResponseSchema>;
export type WalletBalance = Static<typeof WalletBalanceSchema>;
export type LedgerEntry = Static<typeof LedgerEntrySchema>;
export type InventoryItem = Static<typeof InventoryItemSchema>;
export type PlayerDetail = Static<typeof PlayerDetailSchema>;
export type PurchaseRow = Static<typeof PurchaseRowSchema>;
export type IapPurchaseRow = Static<typeof IapPurchaseRowSchema>;
export type RunSummary = Static<typeof RunSummarySchema>;
export type RunsResponse = Static<typeof RunsResponseSchema>;
export type FeatureFlagRow = Static<typeof FeatureFlagRowSchema>;
export type FlagsResponse = Static<typeof FlagsResponseSchema>;
export type FlagWriteRequest = Static<typeof FlagWriteBodySchema>;
export type EconomyResponse = Static<typeof EconomyResponseSchema>;
export type HealthResponse = Static<typeof HealthResponseSchema>;
export type ManifestResponse = Static<typeof ManifestResponseSchema>;
export type ActivityPoint = Static<typeof ActivityPointSchema>;
export type OverviewResponse = Static<typeof OverviewResponseSchema>;
export type AdaptersResponse = Static<typeof AdaptersResponseSchema>;
export type AuditEntry = Static<typeof AuditEntrySchema>;
export type AuditResponse = Static<typeof AuditResponseSchema>;
export type PlayerEntry = Static<typeof PlayerEntrySchema>;
export type PlayerEntriesResponse = Static<typeof PlayerEntriesResponseSchema>;
export type InventoryTransaction = Static<typeof InventoryTransactionSchema>;
export type EconomySummary = Static<typeof EconomySummarySchema>;
