---
title: Troubleshooting
description: Diagnose configuration, authentication, SQLite, and replication failures.
---

## Readiness is 503

Inspect the first startup error. Common causes are missing per-game secrets, an unknown adapter referenced in the manifest, a modified migration checksum, a database newer than the binary, or an unwritable `/data` mount. Do not bypass migration validation.

## Adapter file not loaded

The runtime scans `BANTAM_ADAPTERS_DIR` at boot. If `games.json` references a file spec and the file is absent or its `default` export does not satisfy the contract, startup aborts with `500 adapter-invalid`. Confirm the filename, the export shape, and that the container's volume is mounted read-only.

## PGS exchange returns 401

Confirm the Android client requested the code for the Game server's Web client ID, the code was sent only once and promptly, the PGS project is published for the tester, and the server client secret matches that ID. Do not log the code to diagnose it.

## Submissions return 400

Use the machine-readable error code. For the `generic` adapter, check that every required board is present, values are safe integers, and no unknown keys appear. For custom file adapters, the adapter's own contract applies.

## SQLite is busy

Confirm there is only one Bantam replica and no external process writes the live file. Inspect long requests and transaction duration. Never copy a live database without its WAL state; use Litestream or the documented stopped-writer procedure.

## Restore finds nothing

Check the exact deployment/game replica prefix, bucket endpoint, region, path-style mode, and credentials. `backup-status` must show the configured database. A successful MinIO test proves the workflow, not the production bucket configuration.

## The SDK queue never flushes

Check network availability, optional sign-in result, session refresh, adapter id, and expiry. Authentication cancellation is intentionally non-fatal and leaves the queue intact.
