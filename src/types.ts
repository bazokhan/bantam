export type BoardDirection = "higher" | "lower";
export type BoardPeriod = "all_time" | "daily";

export type BoardDefinition = {
  id: string;
  direction: BoardDirection;
  period: BoardPeriod;
  completedOnly?: boolean;
};

export type DerivedBoardValue = { boardId: string; periodKey: string; value: number };

export type AdapterContext = { nowMs: number; gracePeriodHours: number };

export type AdapterResult = {
  normalized: Record<string, unknown>;
  values: DerivedBoardValue[];
};

export interface GameAdapterV1 {
  readonly id: string;
  readonly version: string;
  readonly boards: readonly BoardDefinition[];
  validateAndDerive(payload: unknown, context: AdapterContext): AdapterResult;
}

// Discriminated union for the game manifest's `adapters` array.
// `file` adapters come from the preloaded directory cache (preloadAdapterDirectory).
// `generic` adapters are synthesized at boot from a JSON board spec.
export type FileAdapterSpec = { kind: "file"; source: string };
export type GenericAdapterSpec = { kind: "generic"; boards: BoardDefinition[] };
export type AdapterSpec = FileAdapterSpec | GenericAdapterSpec;

export type GameManifestEntry = {
  id: string;
  displayName: string;
  adapters: AdapterSpec[];
  secretPrefix: string;
  gracePeriodHours: number;
  authProvider: "pgs-v2" | "development";
};

export type RuntimeGame = GameManifestEntry & {
  identitySalt: string;
  sessionSecret: string;
  cursorSecret: string;
  pgsClientId?: string;
  pgsClientSecret?: string;
};
