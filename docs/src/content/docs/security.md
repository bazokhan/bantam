---
title: Security and privacy
description: Identity, sessions, logging, input, and secret-handling guarantees.
---

- Raw Google player IDs exist only in memory during exchange. Persistent IDs are per-game HMAC pseudonyms.
- Google auth codes and access tokens are never logged or stored.
- Access tokens expire after 15 minutes and are scoped to one game. Opaque refresh tokens expire after 30 days, are stored as hashes, rotate on use, and revoke their family on reuse.
- Admin passwords are hashed with scrypt (`N=16384, r=8, p=1, keylen=64`) and stored as `scrypt$N=…,r=…,p=…$<salt-b64>$<hash-b64>`. Admin sessions are 32-byte opaque tokens, stored as `sha256(token)`, expire after 30 days, and are issued as `HttpOnly`, `SameSite=Strict`, `Secure`, `Path=/admin/` cookies. The first registration creates the only admin and closes registration.
- Requests cap at 64 KiB. Fastify schemas reject unknown outer fields; adapters perform strict payload validation and tighter collection limits.
- Logs contain request ID, method, route path, status, and duration. They omit query strings, bodies, IP addresses, auth headers, cookies, tokens, and player identifiers.
- Display names are NFKC-normalized, stripped of controls and bidirectional overrides, collapsed, and limited to 24 graphemes.
- Submission and read limits persist per player. Authentication exchange limits use an in-memory process-secret fingerprint and never persist raw addresses.
- Per-player deletion removes sessions, runs, board entries, economy rows (wallets, inventory, purchases, IAP records), and the player row atomically.
- Economy clients submit offer ids, request ids, or IAP tokens. Prices, balances, and grants are server-derived. IAP tokens are hashed for uniqueness, never logged, and never rendered in admin HTML. Provider verification runs outside the database transaction.

Use independent secrets per title and purpose. Store them in Coolify or another deployment secret manager, never source control. If a signing secret leaks, rotate it and expect access-token invalidation. If an identity salt leaks, rotate only with an account migration plan because pseudonyms will change.
