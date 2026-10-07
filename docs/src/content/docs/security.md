---
title: Security and privacy
description: Identity, sessions, logging, input, and secret-handling guarantees.
---

- Raw Google player IDs exist only in memory during exchange. Persistent IDs are per-game HMAC pseudonyms.
- Google auth codes and access tokens are never logged or stored.
- Access tokens expire after 15 minutes and are scoped to one game. Opaque refresh tokens expire after 30 days, are stored as hashes, rotate on use, and revoke their family on reuse.
- Requests cap at 64 KiB. Fastify schemas reject unknown outer fields; adapters perform strict payload validation and tighter collection limits.
- Logs contain request ID, method, route path, status, and duration. They omit query strings, bodies, IP addresses, auth headers, cookies, tokens, and player identifiers.
- Display names are NFKC-normalized, stripped of controls and bidirectional overrides, collapsed, and limited to 24 graphemes.
- Submission and read limits persist per player. Authentication exchange limits use an in-memory process-secret fingerprint and never persist raw addresses.
- Per-player deletion removes sessions, runs, board entries, and the player row atomically.

Use independent secrets per title and purpose. Store them in Coolify or another deployment secret manager, never source control. If a signing secret leaks, rotate it and expect access-token invalidation. If an identity salt leaks, rotate only with an account migration plan because pseudonyms will change.
