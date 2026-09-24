import { randomUUID } from "node:crypto";
import { buildDailyDefinition, scoreCompetitiveGate } from "../src/adapters/color-quest-core.js";

const origin = process.env.BANTAM_SMOKE_ORIGIN ?? "http://127.0.0.1:3000";
const date = new Date(Date.now() - 12 * 60 * 60 * 1_000).toISOString().slice(0, 10);
const route = buildDailyDefinition(date);
const eventLedger: Record<string, unknown>[] = [];
let score = 0;
let combo = 0;
let streak = 0;
let activeMs = 0;
for (const [index, chunk] of route.chunks.entries()) {
  activeMs += 5_000;
  const gate = scoreCompetitiveGate("regular", streak, combo, 1, 5_000);
  combo = gate.nextCombo;
  streak = gate.nextPerfectStreak;
  score += gate.totalPoints;
  eventLedger.push({
    type: "gate",
    gate: index + 1,
    obstacleId: chunk.obstacle.id,
    result: "regular",
    alignment: 0.5,
    gateActiveMs: 5_000,
    activeMs,
    points: gate.totalPoints,
    pace: gate.pacePoints,
  });
}
eventLedger.push({ type: "end", activeMs, reason: "daily_complete" });
const payload = {
  runId: `smoke-${randomUUID()}`,
  utcDate: date,
  rulesVersion: "daily-v1",
  seed: route.seed,
  score,
  distanceMeters: 0,
  activeTimeMs: activeMs,
  completed: true,
  gatesCleared: 20,
  eventLedger,
  createdAtMs: Date.parse(`${date}T12:00:00Z`),
};

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${path}`, init);
  const body = response.status === 204 ? undefined : await response.json();
  return { status: response.status, body };
}

const login = await json("/v1/games/color-quest/auth/exchange", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ authorizationCode: `smoke-${randomUUID()}` }),
});
if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login)}`);
const accessToken = (login.body as { accessToken: string }).accessToken;
const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
const submit = await json("/v1/games/color-quest/runs/color-quest-daily-v1", {
  method: "POST",
  headers,
  body: JSON.stringify({ runId: payload.runId, payload }),
});
const replay = await json("/v1/games/color-quest/runs/color-quest-daily-v1", {
  method: "POST",
  headers,
  body: JSON.stringify({ runId: payload.runId, payload }),
});
const tamperedRunId = `tamper-${randomUUID()}`;
const tampered = await json("/v1/games/color-quest/runs/color-quest-daily-v1", {
  method: "POST",
  headers,
  body: JSON.stringify({
    runId: tamperedRunId,
    payload: { ...payload, runId: tamperedRunId, score: score + 1 },
  }),
});
const board = await json(`/v1/games/color-quest/leaderboards/daily_score?period=${date}&limit=25`, {
  headers: { authorization: `Bearer ${accessToken}` },
});
const around = await json(
  `/v1/games/color-quest/leaderboards/daily_score/around-me?period=${date}&radius=3`,
  { headers: { authorization: `Bearer ${accessToken}` } },
);

if (
  submit.status !== 200 ||
  replay.status !== 200 ||
  !(replay.body as { replayed?: boolean }).replayed ||
  tampered.status !== 400 ||
  board.status !== 200 ||
  around.status !== 200
) {
  throw new Error(`smoke check failed: ${JSON.stringify({ submit, replay, tampered, board, around })}`);
}
process.stdout.write(
  `${JSON.stringify({ login: login.status, submit: submit.status, replayed: true, tamper: tampered.status, board: board.status, around: around.status })}\n`,
);
