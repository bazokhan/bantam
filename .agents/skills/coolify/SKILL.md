---
name: coolify
description: Authenticates to the Gamercury Coolify host and performs API actions (list projects/apps, env vars, file/volume mounts, restart, exec). Use when deploying or configuring Coolify apps, especially Bantam Server in project Games, or when the user mentions Coolify, dev.trugraph.io, or live host env.
---

# Coolify (Gamercury)

Self-hosted Coolify API for this studio. **Never paste tokens, env values, or admin passwords into chat, git, plans, or skills.**

## Auth (paths only)

| What                      | Where                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| Coolify UI / API          | `https://dev.trugraph.io` (`/api/v1/...`)                            |
| API token file            | `D:\Gamercury\vault\COOLIFY_API_KEYS.txt`                            |
| Token shape               | Laravel Sanctum `digits\|hex` on its own line (not the MCP URL line) |
| Bantam admin login        | `D:\Gamercury\bantam\deploy\credentials.local\admin.env`             |
| Moon Gravity game secrets | `D:\Gamercury\bantam\deploy\credentials.local\moon-gravity.env`      |

Read those files. Do not echo values. Authorization header: `Bearer <token>`.

## Resolve resources by name

Do not hard-require remembered UUIDs. `GET /api/v1/projects` and `GET /api/v1/applications`, then match:

- Project **Games**
- Application **Bantam Server** (image `bazokhan/bantam`, fqdn includes `https://bantam-api.trugraph.io`)

Print names, status, fqdn, and env **keys** only.

## Common API

All under `https://dev.trugraph.io/api/v1`.

| Action                        | Method   | Path                                                 |
| ----------------------------- | -------- | ---------------------------------------------------- |
| Version                       | GET      | `/version`                                           |
| Projects                      | GET      | `/projects`                                          |
| Applications                  | GET      | `/applications`                                      |
| One app                       | GET      | `/applications/{uuid}`                               |
| List/create env               | GET/POST | `/applications/{uuid}/envs`                          |
| List/create storage           | GET/POST | `/applications/{uuid}/storages`                      |
| Restart                       | POST     | `/applications/{uuid}/restart`                       |
| Exec (needs terminal ability) | POST     | `/applications/{uuid}/exec` body `{"command":"..."}` |

Create env body: `{ "key", "value", "is_preview": false, "is_literal": true, "is_shown_once": true }` for secrets (`false` for CORS). Coolify env changes need a **restart** before the container sees them.

File storage body: `{ "type": "file", "mount_path": "/bantam/adapters/moon-gravity-v1.mjs", "content": "<source>", "is_directory": false }`. Persistent volume for Bantam is already `/data`.

After restart, wait for `GET https://bantam-api.trugraph.io/healthz` then `/readyz`.

## Bantam live wiring (Moon Gravity)

1. Ensure `moon-gravity.env` has `BANTAM_GAME_MOON_GRAVITY_{IDENTITY_SALT,SESSION_SECRET,CURSOR_SECRET}` (≥16 chars) and `BANTAM_ALLOWED_ORIGINS` (localhost:4273 / 5173, 127.0.0.1:4273, https://localhost, capacitor://localhost).
2. POST missing env keys; POST adapter file storage; restart.
3. Admin form POST `username`/`password` to `/admin/login`, then POST `manifest` to `/admin/manifest` (urlencoded). Merge `moon-gravity`; keep other games. Use `environment: "development"` while auth is development — production rejects that provider.
4. Confirm `/version.adapters` includes `moon-gravity-v1` and `/readyz` lists `moon-gravity`.

Adapter source lives in the game repo: `bantam/adapters/moon-gravity-v1.mjs`. Do not commit it into the Bantam server repo.

## Safety

- No secrets in git, skills, chat, or issue text.
- Do not dump `GET .../envs` values.
- Do not stop unrelated Coolify apps or reuse ports.
- Token file also mentions an MCP URL; that is not the REST token.
