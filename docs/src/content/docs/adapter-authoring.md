---
title: Authoring — File adapters
description: Compile a `.mjs` module, mount it, reference it from the manifest.
---

File adapters are `.js` or `.mjs` modules dropped into `BANTAM_ADAPTERS_DIR` (default `/bantam/adapters`). The loader scans the directory at boot, validates each module against the `GameAdapterV1` contract, and rejects duplicates. Restart the container to pick up new files.

## Module shape

```js
// my-game-v1.mjs
export default {
  id: "my-game-v1",
  version: "1.0.0",
  boards: [
    { id: "high_score", direction: "higher", period: "all_time" },
    { id: "today_score", direction: "higher", period: "daily" }
  ],
  validateAndDerive(payload, context) {
    // ...
    return {
      normalized: { ... },
      values: [
        { boardId: "high_score", periodKey: "all_time", value: 42 },
        { boardId: "today_score", periodKey: "2026-09-23", value: 7 }
      ]
    };
  }
};
```

A named export `adapter` is accepted as a fallback if your module prefers that convention.

## Contract

- `id`, `version`: required strings.
- `boards`: readonly array of `{ id, direction, period, completedOnly? }`.
- `validateAndDerive(payload, ctx)`: pure function. `ctx.nowMs` is wall-clock ms; `ctx.gracePeriodHours` is the per-game grace window. Return `{ normalized, values }` where each `value` is `{ boardId, periodKey, value }` and `value` is a safe integer.

The loader rejects modules that violate any part of this contract with HTTP `500 adapter-invalid` at boot.

## Reference fixture

The repo ships an `echo-v1.mjs` smoke adapter under `test/fixtures/adapters/`. It's used by the `adapters:smoke` lane and the Compose-mounted `/bantam/adapters/` directory to prove the loader against a live HTTP request.

## Hot reload

Not supported. Restart the container after adding, editing, or removing adapter files.

## TypeScript authoring is not supported at runtime

Authors compile to `.js`/`.mjs` and ship the compiled artifact. The runtime container has no transpiler.
