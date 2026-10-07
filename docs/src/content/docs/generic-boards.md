---
title: Authoring — Generic boards
description: Zero-code configuration for trivial games.
---

The `generic` adapter is built into the framework. The game dev declares boards in `games.json`; the server synthesizes a `GameAdapterV1` instance at boot. No file writes, no build step.

## Manifest

```json
{
  "id": "demo",
  "displayName": "Demo",
  "adapters": [
    {
      "kind": "generic",
      "boards": [
        { "id": "high_score", "direction": "higher", "period": "all_time" },
        { "id": "today_score", "direction": "higher", "period": "daily" }
      ]
    }
  ],
  "secretPrefix": "BANTAM_GAME_DEMO",
  "gracePeriodHours": 24,
  "authProvider": "development"
}
```

## Payload contract

The submitted payload is a plain object whose keys are board ids and whose values are safe integers:

```json
{ "high_score": 42, "today_score": 7 }
```

- Unknown keys → `400 unknown-field`.
- Missing non-`completedOnly` board value → `400 invalid-value`.
- Non-integer values → `400 invalid-value`.

## periodKey derivation

- `period: "daily"` → today UTC date `YYYY-MM-DD`.
- `period: "all_time"` → `"all_time"`.

The synthesized adapter does not honor a payload date. If a game needs deterministic historical `periodKey` or richer validation, write a real file-based adapter instead.

## Submitting

The synthesized adapter id is deterministic: `generic:<sorted board ids>`. With one `high_score` board, the runs route is:

```
POST /v1/games/demo/runs/generic:high_score
{ "runId": "run-...", "payload": { "high_score": 42 } }
```
