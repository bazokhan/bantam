import { BantamError } from "../errors.js";
import type { AdapterContext, AdapterResult, GameAdapterV1 } from "../types.js";
import {
  DAILY_ROUTE_LENGTH,
  DAILY_RULES_VERSION,
  buildDailyDefinition,
  isPerfectAlignment,
  metersFromPixels,
  progressPointsForMeters,
  scoreCompetitiveGate,
} from "./color-quest-core.js";

type Event = Record<string, unknown>;
type Submission = {
  runId: string;
  utcDate: string;
  rulesVersion: string;
  seed: string;
  score: number;
  distanceMeters: number;
  activeTimeMs: number;
  completed: boolean;
  gatesCleared: number;
  eventLedger: Event[];
  createdAtMs: number;
};

function integer(value: unknown, min: number, max: number, code: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new BantamError(code, code);
  return number;
}

function submission(input: unknown): Submission {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new BantamError("invalid-submission", "Invalid submission");
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    "runId",
    "utcDate",
    "rulesVersion",
    "seed",
    "score",
    "distanceMeters",
    "activeTimeMs",
    "completed",
    "gatesCleared",
    "eventLedger",
    "createdAtMs",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new BantamError("unknown-field", "Unknown submission field");
  if (typeof value.runId !== "string" || !/^[A-Za-z0-9._~-]{8,128}$/.test(value.runId))
    throw new BantamError("invalid-run-id", "Invalid run id");
  if (
    typeof value.utcDate !== "string" ||
    typeof value.rulesVersion !== "string" ||
    typeof value.seed !== "string"
  )
    throw new BantamError("invalid-submission", "Invalid route identity");
  if (!Array.isArray(value.eventLedger) || value.eventLedger.length > 160)
    throw new BantamError("invalid-ledger", "Invalid event ledger");
  if (typeof value.completed !== "boolean")
    throw new BantamError("invalid-submission", "Invalid completion state");
  return {
    runId: value.runId,
    utcDate: value.utcDate,
    rulesVersion: value.rulesVersion,
    seed: value.seed,
    score: integer(value.score, 0, 10_000_000, "invalid-score"),
    distanceMeters: integer(value.distanceMeters, 0, 100_000, "invalid-distance"),
    activeTimeMs: integer(value.activeTimeMs, 0, 60 * 60_000, "invalid-active-time"),
    completed: value.completed,
    gatesCleared: integer(value.gatesCleared, 0, DAILY_ROUTE_LENGTH, "invalid-gates"),
    eventLedger: value.eventLedger as Event[],
    createdAtMs: integer(value.createdAtMs, 0, 9_000_000_000_000_000, "invalid-created-at"),
  };
}

export class ColorQuestDailyV1Adapter implements GameAdapterV1 {
  readonly id = "color-quest-daily-v1";
  readonly version = "1.0.0";
  readonly boards = [
    { id: "daily_score", direction: "higher", period: "daily" },
    { id: "daily_fastest_finish", direction: "lower", period: "daily", completedOnly: true },
  ] as const;

  validateAndDerive(payload: unknown, context: AdapterContext): AdapterResult {
    const input = submission(payload);
    if (input.rulesVersion !== DAILY_RULES_VERSION)
      throw new BantamError("invalid-rules-version", "Invalid rules version");
    let route: ReturnType<typeof buildDailyDefinition>;
    try {
      route = buildDailyDefinition(input.utcDate);
    } catch {
      throw new BantamError("invalid-date", "Invalid UTC date");
    }
    if (input.seed !== route.seed) throw new BantamError("invalid-route", "Invalid route");
    const start = Date.parse(`${input.utcDate}T00:00:00.000Z`);
    const expiry = start + context.gracePeriodHours * 60 * 60_000;
    if (context.nowMs < start - 5 * 60_000 || context.nowMs > expiry)
      throw new BantamError("expired-day", "Submission period expired");
    if (input.createdAtMs < start - 5 * 60_000 || input.createdAtMs > context.nowMs + 5 * 60_000)
      throw new BantamError("invalid-created-at", "Invalid run creation time");

    let score = 0,
      combo = 0,
      streak = 0,
      gates = 0,
      shields = 0,
      penaltyMs = 0,
      lastActiveMs = 0,
      progressAwarded = 0;
    let lastMultiplierMs = Number.NEGATIVE_INFINITY;
    let ended = false;
    const pickups = new Set<string>();
    for (const event of input.eventLedger) {
      if (!event || typeof event !== "object" || Array.isArray(event))
        throw new BantamError("invalid-event", "Invalid event");
      if (ended) throw new BantamError("event-after-end", "Event after end");
      const type = String(event.type ?? "");
      const activeMs = integer(event.activeMs, 0, 60 * 60_000, "invalid-active-time", lastActiveMs);
      if (activeMs < lastActiveMs) throw new BantamError("event-order", "Event order invalid");
      lastActiveMs = activeMs;
      if (type === "progress") {
        const meters = integer(
          event.meters,
          0,
          metersFromPixels(route.totalDistancePx) + 100,
          "invalid-progress-distance",
        );
        const expected = progressPointsForMeters(meters);
        if (expected <= progressAwarded) throw new BantamError("progress-order", "Progress order invalid");
        const multiplier = lastActiveMs - lastMultiplierMs <= 9_000 ? 2 : 1;
        const points = (expected - progressAwarded) * multiplier;
        if (event.progressPoints !== expected || event.points !== points || event.multiplier !== multiplier)
          throw new BantamError("progress-mismatch", "Progress mismatch");
        progressAwarded = expected;
        score += points;
        continue;
      }
      if (type === "pickup") {
        const gate = integer(event.gate, 0, DAILY_ROUTE_LENGTH - 1, "invalid-pickup-gate");
        const kind = String(event.kind ?? "");
        const chunk = route.chunks[gate]!;
        const expected = kind === "switch" ? chunk.switchToColorIndex !== undefined : chunk.reward === kind;
        if (!expected || !["switch", "star", "gem", "shield", "multiplier"].includes(kind))
          throw new BantamError("invalid-pickup", "Pickup does not exist on route");
        const key = `${gate}:${kind}`;
        if (pickups.has(key)) throw new BantamError("duplicate-pickup", "Duplicate pickup");
        pickups.add(key);
        const multiplier = lastActiveMs - lastMultiplierMs <= 9_000 ? 2 : 1;
        const points = kind === "star" ? 5 * multiplier : kind === "gem" ? 10 * multiplier : 0;
        if (Number(event.points ?? 0) !== points)
          throw new BantamError("pickup-score-mismatch", "Pickup score mismatch");
        if (kind === "star" || kind === "gem") score += points;
        if (kind === "shield") shields += 1;
        if (kind === "multiplier") lastMultiplierMs = lastActiveMs;
        continue;
      }
      if (type === "gate") {
        if (gates >= DAILY_ROUTE_LENGTH) throw new BantamError("excess-gates", "Too many gates");
        const expected = route.chunks[gates]!.obstacle;
        if (event.obstacleId !== expected.id || event.gate !== gates + 1)
          throw new BantamError("gate-order", "Gate order invalid");
        const result = String(event.result ?? "") as "regular" | "perfect" | "shielded";
        if (!["regular", "perfect", "shielded"].includes(result))
          throw new BantamError("invalid-gate-result", "Invalid gate result");
        const alignment = Number(event.alignment);
        if (
          !Number.isFinite(alignment) ||
          alignment < 0 ||
          alignment > 1 ||
          (result === "perfect") !== isPerfectAlignment(alignment)
        )
          throw new BantamError("invalid-perfect", "Invalid gate alignment");
        if (result === "shielded") {
          if (shields < 1) throw new BantamError("shield-underflow", "Shield unavailable");
          shields -= 1;
        }
        const elapsed = integer(event.gateActiveMs, 0, 120_000, "invalid-pace");
        const multiplier = lastActiveMs - lastMultiplierMs <= 9_000 ? 2 : 1;
        const gate = scoreCompetitiveGate(result, streak, combo, multiplier, elapsed);
        if (event.points !== undefined && Number(event.points) !== gate.totalPoints)
          throw new BantamError("gate-score-mismatch", "Gate score mismatch");
        if (event.pace !== undefined && Number(event.pace) !== gate.pacePoints)
          throw new BantamError("gate-score-mismatch", "Gate pace mismatch");
        score += gate.totalPoints;
        combo = gate.nextCombo;
        streak = gate.nextPerfectStreak;
        gates += 1;
        continue;
      }
      if (type === "shield_rescue") {
        if (shields < 1 || event.penaltyMs !== 3_000 || event.gate !== gates)
          throw new BantamError("invalid-shield-rescue", "Invalid shield rescue");
        shields -= 1;
        penaltyMs += 3_000;
        combo = 0;
        streak = 0;
        continue;
      }
      if (type === "end") {
        ended = true;
        continue;
      }
      if (type === "rewarded_revive")
        throw new BantamError("daily-revive-forbidden", "Daily revive forbidden");
      throw new BantamError("unknown-event", "Unknown event");
    }
    const maxDistance = metersFromPixels(route.totalDistancePx) + 100;
    const distance = integer(input.distanceMeters, 0, maxDistance, "invalid-distance");
    if (!ended) throw new BantamError("missing-end", "Missing end event");
    if (progressAwarded !== progressPointsForMeters(distance))
      throw new BantamError("missing-progress", "Progress ledger incomplete");
    const completed = gates === DAILY_ROUTE_LENGTH;
    const activeTimeMs = lastActiveMs + penaltyMs;
    if (input.completed !== completed || input.gatesCleared !== gates)
      throw new BantamError("completion-mismatch", "Completion mismatch");
    if (Math.abs(input.activeTimeMs - activeTimeMs) > 300)
      throw new BantamError("time-mismatch", "Time mismatch");
    if (input.score !== score) throw new BantamError("score-mismatch", "Score mismatch");
    if (completed && activeTimeMs < 8_000)
      throw new BantamError("impossible-completion-time", "Impossible completion time");
    return {
      normalized: {
        score,
        distanceMeters: distance,
        activeTimeMs,
        completed,
        gatesCleared: gates,
        utcDate: input.utcDate,
        rulesVersion: input.rulesVersion,
      },
      values: [
        { boardId: "daily_score", periodKey: input.utcDate, value: score },
        ...(completed
          ? [{ boardId: "daily_fastest_finish", periodKey: input.utcDate, value: activeTimeMs }]
          : []),
      ],
    };
  }
}
