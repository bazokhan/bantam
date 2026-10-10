---
title: API and SDK reference
description: HTTP endpoints, errors, sessions, and typed client usage.
---

The generated [OpenAPI JSON](/reference/bantam.openapi.json) is copied from the service repository. Run `npm run reference:check` to detect drift.

## System

| Method | Path            | Authentication         |
| ------ | --------------- | ---------------------- |
| GET    | `/healthz`      | Public                 |
| GET    | `/readyz`       | Public                 |
| GET    | `/version`      | Public                 |
| GET    | `/openapi.json` | Public                 |
| GET    | `/metrics`      | Optional monitor token |

## Game API

All paths begin `/v1/games/{gameId}`.

| Method | Path                                | Purpose                                      |
| ------ | ----------------------------------- | -------------------------------------------- |
| POST   | `/auth/exchange`                    | Exchange a PGS server auth code              |
| POST   | `/auth/refresh`                     | Rotate a refresh token                       |
| POST   | `/auth/logout`                      | Revoke the refresh family                    |
| POST   | `/runs/{adapterId}`                 | Submit evidence for authoritative derivation |
| GET    | `/leaderboards/{boardId}`           | Page through entries                         |
| GET    | `/leaderboards/{boardId}/me`        | Get the caller’s rank                        |
| GET    | `/leaderboards/{boardId}/around-me` | Get neighboring entries                      |
| DELETE | `/player`                           | Delete the caller’s Bantam data              |

Errors use `{ "error": { "code", "message", "requestId" } }`. Treat `401` as a refresh or reauthentication signal, `409 run-id-conflict` as tampering or a broken client ID generator, and `429` as retryable with backoff.

## TypeScript SDK

Install from the public registry (not a sibling `file:` path). Publish workflow: [SDK on npm](/sdk/).

```ts
import { BantamClient, BrowserStorage } from "@gamercury/bantam-sdk";

const bantam = new BantamClient({
  baseUrl: "https://api.example.com",
  gameId: "demo",
  storage: new BrowserStorage(),
});

const result = await bantam.optionalLogin(() => nativePgs.requestServerAuthCode());
// cancelled/unavailable leaves offline gameplay and queued runs untouched.
```

Provide `queueBest()` with the evidence payload and client-side candidate hints. The SDK refreshes sessions, retains retryable work, discards expired queues, and removes every reference to a successfully accepted run.

## Committed SDK snapshot

The reconciliation check also publishes the exact [typed SDK source snapshot](/reference/bantam-sdk.ts) used by this release, alongside the [OpenAPI snapshot](/reference/bantam.openapi.json).

## See also

- Source repository: <https://github.com/bazokhan/bantam>
- Docker image: [`bazokhan/bantam`](https://hub.docker.com/r/bazokhan/bantam) on Docker Hub
- Marketing page: <https://gamercury.trugraph.io/projects/bantam>
- Studio: [Gamercury Studio](https://gamercury.trugraph.io)
