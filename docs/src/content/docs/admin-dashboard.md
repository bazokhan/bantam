---
title: Admin dashboard
description: Token-gated read-only UI for inspecting games, adapters, and runs.
---

The framework includes a token-gated web admin UI on the same port as the API.

## Enabling

```bash
BANTAM_ADMIN_TOKEN=<random-32-bytes> docker compose up -d
curl -H "Authorization: Bearer <token>" http://localhost:3000/admin/
```

If `BANTAM_ADMIN_TOKEN` is unset, `/admin/*` returns 404 and the routes are not registered.

## Routes

| Path                        | Purpose                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| `/admin`                    | Landing page with link grid.                                                      |
| `/admin/games`              | Per-game id, display name, adapter count, db readiness.                           |
| `/admin/games/:gameId`      | Manifest, boards, top 10 for the first generic board.                             |
| `/admin/games/:gameId/runs` | Last 20 runs (runId, adapterId, createdAt, payloadHash only — no payload bodies). |
| `/admin/adapters`           | Loaded adapter list (id, version, board count, which games include it).           |
| `/admin/health`             | Per-game db readiness and adapter coverage.                                       |

## Trust

The admin token is a separate secret from `BANTAM_METRICS_TOKEN`. It is intended for a single trusted caller (operator dashboard or automation). There is no rate limiting and no audit log in v1; both are deferred until write actions are added.

The OpenAPI spec at `/openapi.json` remains public; the admin UI is the only privileged surface.
