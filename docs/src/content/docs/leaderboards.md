---
title: Authoritative leaderboards
description: Best-score, ranking, pagination, and offline submission behavior.
---

Boards belong to adapters. A definition chooses `higher` or `lower` and either `all_time` or a UTC date period. Clients submit evidence to a run adapter; they never send a trusted board value.

## Semantics

- The first accepted value becomes the player's best.
- Only a strictly better value replaces it. Equal values preserve the original achievement time.
- Equal values have the same competition rank. Display order inside a tie is earliest achievement, then internal row ID.
- A run and all board improvements commit in one short transaction.
- An exact retry of player, adapter, and run ID returns the stored result. Reusing that identity with different content returns `409 run-id-conflict`.
- List pages default to 25 and cap at 100. Signed cursors prevent caller modification.
- `around-me` defaults to three entries on each side and caps at ten.

## Offline best-only queues

The SDK keeps the best queued candidate per board and period. Candidate values are hints used only to compact local storage; Bantam ignores them. When one run is the best candidate for multiple boards, a successful idempotent submission removes all queue references to that run.

Date boards reject submissions outside the adapter's configured grace period. The `generic` synthesized adapter enforces the grace window from `game.gracePeriodHours`; custom file adapters may enforce tighter rules.

## See also

Leaderboards are one surface. The same game can also ship [feature flags](/flags/) and an optional [economy](/economy/) catalog. Clients use `@gamercury/bantam-sdk` for all three.
