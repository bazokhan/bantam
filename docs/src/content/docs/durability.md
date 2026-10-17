---
title: SQLite, WAL, backups, and restores
description: Understand Bantam's durability model and recovery commands.
---

## SQLite boundary

Each game owns `/data/games/<game-id>/bantam.sqlite`. Bantam enables WAL, foreign keys, `synchronous=NORMAL`, a five-second busy timeout, and bounded automatic checkpoints. Transactions use `BEGIN IMMEDIATE`, contain no network calls, and cover only rate updates, session rotation, or a run plus its board improvements.

WAL improves concurrency; it does not permit multiple application writers. Run one Bantam replica against a volume. A network filesystem that does not provide SQLite's locking guarantees is unsupported.

## Litestream

Litestream supervises the Node process and continuously replicates every configured database to:

```text
s3://<bucket>/<prefix>/<deployment-id>/<game-id>
```

Set `LITESTREAM_REPLICA_URL`, optional `LITESTREAM_ENDPOINT`, `AWS_REGION`, access credentials, and path-style mode when required. Replication lag and credentials must be tested against the real provider; a local MinIO pass is not external proof.

## Checks and recovery

```powershell
npm run ops -- quick-check demo
npm run ops -- integrity demo
npm run ops -- backup-status
```

For recovery, stop the writer first. `restore-if-missing` never overwrites a file. Explicit restore also refuses an existing database unless `--force` and an exact configured game ID are supplied.

After restore, run the full integrity check, start Bantam, verify readiness, authenticate a test player, and compare expected leaderboard, flag, and economy state. Record the chosen replica generation and recovery point.
