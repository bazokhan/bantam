# Bantam reference

Fetch `GET {base}/openapi.json` before relying on this file. Docs site: https://bantam.trugraph.io (slugs: adapters, generic-boards, adapter-authoring, configuration, admin-dashboard, reference, security).

## Public HTTP

Prefix: `/v1/games/{gameId}` unless noted. `gameId` 2–48 chars.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | Liveness |
| GET | `/readyz` | Readiness |
| GET | `/version` | `{ name, version, commit, builtAt, adapters }` |
| GET | `/openapi.json` | OpenAPI 3.0.3 |
| POST | `/v1/games/{gameId}/auth/exchange` | Body `{ authorizationCode }` (1–2048). Development: any non-empty code. `pgs-v2`: Play Games server auth code. |
| POST | `/v1/games/{gameId}/auth/refresh` | `{ refreshToken }` |
| POST | `/v1/games/{gameId}/auth/logout` | `{ refreshToken }` |
| POST | `/v1/games/{gameId}/runs/{adapterId}` | `{ runId, payload }`. `runId` `^[A-Za-z0-9._~-]{8,128}$`. Bearer required. Adapter derives boards. |
| GET | `/v1/games/{gameId}/leaderboards/{boardId}` | Query `period`, `cursor`, `limit` (1–100) |
| GET | `/v1/games/{gameId}/leaderboards/{boardId}/me` | Query `period`, `radius` (1–10) |
| GET | `/v1/games/{gameId}/leaderboards/{boardId}/around-me` | Query `period`, `radius` (1–10) |
| DELETE | `/v1/games/{gameId}/player` | Erasure. Bearer required. |

No achievements routes. Admin UI under `/admin/*` (cookie session). Admin run list omits payload bodies.

## Manifest (`games.json`)

```json
{
  "environment": "development" | "test" | "production",
  "games": [
    {
      "id": "my-game",
      "displayName": "My Game",
      "adapters": [
        { "kind": "file", "source": "my-game-v1.mjs" },
        {
          "kind": "generic",
          "boards": [{ "id": "high_score", "direction": "higher", "period": "all_time" }]
        }
      ],
      "secretPrefix": "BANTAM_GAME_MY_GAME",
      "gracePeriodHours": 24,
      "authProvider": "development"
    }
  ]
}
```

Constraints: additionalProperties false; max 64 games; `id` `^[a-z0-9][a-z0-9-]{1,47}$`; `displayName` 1–80; 1–16 adapters; `secretPrefix` `^[A-Z][A-Z0-9_]{1,47}$`; `gracePeriodHours` 0–168; `authProvider` `pgs-v2` | `development`. Generic `boards` 1–16; each board `id` 1–80, `direction` higher|lower, `period` all_time|daily, optional `completedOnly`. File `source` is the basename under `BANTAM_ADAPTERS_DIR` (default `/bantam/adapters`). Empty `games` is valid (admin creates the first). Production + `development` auth is a boot error.

Writable path: `/data/games.json` unless `BANTAM_CONFIG_FILE` is a readable mount (then the editor is read-only).

## `GameAdapterV1`

```ts
type BoardDefinition = {
  id: string;
  direction: "higher" | "lower";
  period: "all_time" | "daily";
  completedOnly?: boolean;
};
type AdapterContext = { nowMs: number; gracePeriodHours: number };
type AdapterResult = {
  normalized: Record<string, unknown>;
  values: { boardId: string; periodKey: string; value: number }[];
};
interface GameAdapterV1 {
  readonly id: string;
  readonly version: string;
  readonly boards: readonly BoardDefinition[];
  validateAndDerive(payload: unknown, context: AdapterContext): AdapterResult;
}
```

Module: default export or named `adapter`. Generic payload is `{ [boardId]: safeInteger }` only; unknown keys reject. File adapters own their payload contract. Daily `periodKey` is UTC `YYYY-MM-DD` from `context.nowMs`.

## SDK (`@gamercury/bantam-sdk`)

Public npm: `npm install @gamercury/bantam-sdk`. Source: `packages/sdk`. Do not use a sibling `file:` dependency. Maintainers publish with GitHub Actions trusted publishing (`publish-sdk.yml`, GitHub username + repo, no org, no `NPM_TOKEN`): [SDK on npm](https://bantam.trugraph.io/sdk/). Class `BantamClient({ baseUrl, gameId, storage, timeoutMs?, fetch? })`.

| Method | Role |
| --- | --- |
| `optionalLogin(getServerAuthCode)` | `authenticated` / `cancelled` / `unavailable`. Stores session, then `flushQueue`. |
| `logout()` | Best-effort server logout; always clears local session. |
| `queueBest(run)` | Keeps the best queued run per adapter+board+period; then flush. |
| `flushQueue()` | POST `/runs/{adapterId}`. Drop expired. Drop 4xx except 401/429. Stop on other failures. |
| `leaderboard(boardId, { period?, cursor?, limit? })` | `{ entries, nextCursor }` |
| `myRank(boardId, period?)` | `{ entry }` |
| `aroundMe(boardId, period?, radius?)` | `{ entries }` |
| `deleteMyData()` | DELETE `/player`; clears session and queue keys. |

`QueuedRun`: `{ gameId, adapterId, runId, payload, candidates, expiresAt? }`. `CandidateValue`: `{ boardId, periodKey, value, direction }`. Storage keys: `bantam:{gameId}:session` and `bantam:{gameId}:queue`. Default timeout 10s.

## Env names only

| Name | Purpose |
| --- | --- |
| `${secretPrefix}_IDENTITY_SALT` | HMAC player pseudonyms |
| `${secretPrefix}_SESSION_SECRET` | Access tokens |
| `${secretPrefix}_CURSOR_SECRET` | Leaderboard cursors |
| `${secretPrefix}_PGS_CLIENT_ID` | Required if `pgs-v2` |
| `${secretPrefix}_PGS_CLIENT_SECRET` | Required if `pgs-v2` |
| `BANTAM_ADAPTERS_DIR` | Default `/bantam/adapters` |
| `BANTAM_DATA_DIR` | Default `/data` |
| `BANTAM_CONFIG_FILE` | Optional manifest mount |
| `BANTAM_ALLOWED_ORIGINS` | CORS allow list |
| `BANTAM_ONLY_GAME` | Load a single game id |
| `BANTAM_METRICS_TOKEN` | Optional metrics gate |
| `PORT` | Default 3000 |

Never paste values. Operator admin path: `deploy/the deployment secret store`.
