---
title: Scaling and migration
description: Know when to leave the single-writer boundary.
---

Bantam is designed for one modest writer with many reads. Measure write latency, busy retries, WAL size, disk headroom, checkpoint duration, backup lag, and recovery time. Add CPU or memory to the single replica before attempting horizontal application replicas.

## PostgreSQL

Replace the game-database repository with PostgreSQL transactions while retaining HTTP schemas, session claims, adapter interfaces, run hashes, and ranking semantics. Backfill players, sessions, runs, and entries per game; dual-read comparisons should prove rank parity before cutover. Do not dual-write from clients.

## Nakama

Move identity/session and leaderboard storage into Nakama, but keep deterministic adapter validation in authoritative server hooks. Map Bantam’s per-game pseudonym and run idempotency contract explicitly rather than trusting client score submissions.

## Managed services

Managed authentication, databases, or leaderboards may replace individual boundaries. Preserve per-title isolation, server derivation, deletion, replay protection, and export/recovery procedures. Vendor availability does not remove the need for offline gameplay behavior.
