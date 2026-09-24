import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDailyDefinition, scoreCompetitiveGate } from "../src/adapters/color-quest-core.js";

function validRun(date: string, gatesToClear: number, runId: string) {
  const route = buildDailyDefinition(date);
  const eventLedger: Record<string, unknown>[] = [];
  let score = 0;
  let combo = 0;
  let streak = 0;
  let activeMs = 0;
  for (let index = 0; index < gatesToClear; index += 1) {
    activeMs += 5_000;
    const gate = scoreCompetitiveGate("regular", streak, combo, 1, 5_000);
    combo = gate.nextCombo;
    streak = gate.nextPerfectStreak;
    score += gate.totalPoints;
    eventLedger.push({
      type: "gate",
      gate: index + 1,
      obstacleId: route.chunks[index]!.obstacle.id,
      result: "regular",
      alignment: 0.5,
      gateActiveMs: 5_000,
      activeMs,
      points: gate.totalPoints,
      pace: gate.pacePoints,
    });
  }
  eventLedger.push({ type: "end", activeMs, reason: gatesToClear === 20 ? "daily_complete" : "quit" });
  return {
    runId,
    utcDate: date,
    rulesVersion: "daily-v1",
    seed: route.seed,
    score,
    distanceMeters: 0,
    activeTimeMs: activeMs,
    completed: gatesToClear === 20,
    gatesCleared: gatesToClear,
    eventLedger,
    createdAtMs: Date.parse(`${date}T12:00:00Z`),
  };
}

const fixture = {
  fixtureVersion: 1,
  source: "Color Quest daily-v1 authoritative validation contract",
  generatedBy: "npm run fixtures:generate",
  validComplete: validRun("2026-09-23", 20, "fixture-complete-0001"),
  validPartial: validRun("2026-09-23", 2, "fixture-partial-0001"),
  rejectionClasses: [
    "wrong-date",
    "wrong-seed",
    "wrong-rules",
    "reordered-event",
    "event-after-end",
    "duplicate-pickup",
    "excess-pickup",
    "pickup-route-mismatch",
    "gate-order",
    "score-tampering",
    "time-tampering",
    "completion-tampering",
    "shield-underflow",
    "forbidden-revive",
    "oversized-ledger",
    "expired-submission",
    "impossible-completion-time",
    "altered-run-id",
  ],
};
const serialized = `${JSON.stringify(fixture, null, 2)}\n`;
const target = join(process.cwd(), "fixtures", "color-quest", "daily-v1.golden.json");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== serialized) throw new Error("Color Quest golden fixtures are stale");
  process.stdout.write("Color Quest golden fixtures match.\n");
} else {
  writeFileSync(target, serialized);
  process.stdout.write(`${target}\n`);
}
