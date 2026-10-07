// Live HTTP smoke against a running server. Runs against the demo games:
//   - generic `demo`        -> payload { high_score: number }
//   - file-based `echo-demo` -> payload { value: number }
//
// Auth uses the development provider: any code matching ^[A-Za-z0-9._~-]{3,128}$.
// Asserts: 200 on login, 200 on first submit + replay=true, 400 on tampered
// payload, 200 on leaderboard read and around-me read.

import { randomUUID } from "node:crypto";

const origin = process.env.BANTAM_SMOKE_ORIGIN ?? "http://127.0.0.1:3000";

async function json(path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${origin}${path}`, init);
  const body = response.status === 204 ? undefined : await response.json();
  return { status: response.status, body };
}

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

async function login(gameId: string, code: string): Promise<string> {
  const response = await json(`/v1/games/${gameId}/auth/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authorizationCode: code }),
  });
  if (response.status !== 200) throw new Error(`login failed: ${JSON.stringify({ gameId, response })}`);
  return (response.body as { accessToken: string }).accessToken;
}

const token = await login("demo", `smoke-${randomUUID()}`);
const runId = `smoke-${randomUUID()}`;
const submit = await json("/v1/games/demo/runs/generic:high_score", {
  method: "POST",
  headers: headers(token),
  body: JSON.stringify({ runId, payload: { high_score: 42 } }),
});
if (submit.status !== 200) throw new Error(`submit failed: ${JSON.stringify(submit)}`);

const replay = await json("/v1/games/demo/runs/generic:high_score", {
  method: "POST",
  headers: headers(token),
  body: JSON.stringify({ runId, payload: { high_score: 42 } }),
});
if (replay.status !== 200 || !(replay.body as { replayed?: boolean }).replayed)
  throw new Error(`replay failed: ${JSON.stringify(replay)}`);

const tampered = await json("/v1/games/demo/runs/generic:high_score", {
  method: "POST",
  headers: headers(token),
  body: JSON.stringify({ runId: `tamper-${randomUUID()}`, payload: { high_score: 99, junk: 1 } }),
});
if (tampered.status !== 400) throw new Error(`tampered expected 400, got ${JSON.stringify(tampered)}`);

const board = await json("/v1/games/demo/leaderboards/high_score?limit=10", { headers: headers(token) });
if (board.status !== 200) throw new Error(`board failed: ${JSON.stringify(board)}`);
const entries = (board.body as { entries: { value: number }[] }).entries;
if (!entries.some((entry) => entry.value === 42))
  throw new Error(`leaderboard missing value 42: ${JSON.stringify(entries)}`);

const around = await json("/v1/games/demo/leaderboards/high_score/around-me?radius=3", {
  headers: headers(token),
});
if (around.status !== 200) throw new Error(`around-me failed: ${JSON.stringify(around)}`);

// File-based adapter: prove the loader pulled echo-v1 from the mounted volume.
const echoToken = await login("echo-demo", `smoke-${randomUUID()}`);
const echoRunId = `smoke-${randomUUID()}`;
const echoSubmit = await json("/v1/games/echo-demo/runs/echo-v1", {
  method: "POST",
  headers: headers(echoToken),
  body: JSON.stringify({ runId: echoRunId, payload: { value: 7 } }),
});
if (echoSubmit.status !== 200) throw new Error(`echo submit failed: ${JSON.stringify(echoSubmit)}`);
const echoBoard = await json("/v1/games/echo-demo/leaderboards/echo?limit=10", {
  headers: headers(echoToken),
});
if (echoBoard.status !== 200) throw new Error(`echo board failed: ${JSON.stringify(echoBoard)}`);
const echoEntries = (echoBoard.body as { entries: { value: number }[] }).entries;
if (!echoEntries.some((entry) => entry.value === 7))
  throw new Error(`echo leaderboard missing value 7: ${JSON.stringify(echoEntries)}`);

process.stdout.write(
  `${JSON.stringify({
    login: 200,
    submit: submit.status,
    replayed: true,
    tamper: tampered.status,
    board: board.status,
    around: around.status,
    echoSubmit: echoSubmit.status,
    echoBoard: echoBoard.status,
  })}\n`,
);
