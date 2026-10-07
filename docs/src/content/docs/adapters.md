---
title: Adapter contract
description: The GameAdapterV1 interface every adapter implements.
---

`GameAdapterV1` exposes an immutable `id`, a `version`, `boards`, and `validateAndDerive(payload, context)`. A successful result contains normalized evidence and derived board values. The service validates those results again before writing them.

An adapter must:

1. Reject unknown or unbounded input.
2. Regenerate authoritative state from stable rules and versioned seeds when the game requires determinism.
3. Validate order, resource accounting, completion, time bounds, replay identity, and expiry.
4. Return integers suitable for SQLite ordering.
5. Keep all work pure and free of network access — adapters run inside the request path before the DB transaction commits.

Reference the adapter by id and version in `games.json`:

```json
{ "kind": "file", "source": "my-game-v1.mjs" }
```

The framework synthesizes a generic adapter for trivial games without code:

```json
{ "kind": "generic", "boards": [{ "id": "high_score", "direction": "higher", "period": "all_time" }] }
```

See [Authoring — File adapters](/adapter-authoring/) and [Authoring — Generic boards](/generic-boards/) for the full authoring guide.
