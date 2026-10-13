---
name: bantam-deployment-gotchas
description: Diagnose and fix common bantam deployment failures across Docker Hub, Vercel docs site, and self-hosted orchestrators (Coolify, Portainer, etc.). Use when a deployment fails, a URL returns 404/502, the image won't pull, or the docs site isn't updating.
---

Read this skill when:

- A deployed bantam returns 404, 502, or stays unhealthy after a redeploy.
- The Docker image pulls but the container exits immediately.
- The Vercel docs site stays on an old build after a `git push`.
- `npm run verify` passes locally but CI fails (or vice versa).
- The orchestrator (Coolify, etc.) shows a port mismatch or "container not reachable".

## Pre-flight checklist (always run first)

1. **Image exists and matches what the orchestrator pulls**: `docker manifest inspect bazokhan/bantam:latest` returns a real index with amd64 + arm64. If it 401s, the registry is fine — recheck the image tag in the orchestrator.
2. **Container boots cleanly locally** before debugging orchestrator wiring:
   ```bash
   docker run -d --rm --name bantam-smoke -p 13001:3000 -v bantam-smoke-data:/data bazokhan/bantam:latest
   sleep 5
   curl -fsS -m 5 http://127.0.0.1:13001/healthz
   curl -fsS -m 5 http://127.0.0.1:13001/readyz
   ```
   Both must return JSON before touching orchestrator config.
3. **`/readyz` shows `{"status":"ready","games":[...]}`**. If empty `games: []`, that's fine (boot succeeded with no manifest). If 503, one or more game databases failed to open — check `/data/games/<id>/bantam.sqlite` perms and the `/data` volume mount.

## Symptoms → root causes

### "Container keeps restarting, orchestrator shows `running:unhealthy`"

| Cause                                                                                                  | How to confirm                                                                     | Fix                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------------- |
| Port mismatch: orchestrator proxies to 80 but app listens on 3000                                      | `ports_exposes` is `80` in the orchestrator config                                 | Set `ports_exposes` and `ports_mappings` to `3000:3000`. Some orchestrators require a redeploy after this change.                                                                                                                                     |
| Missing `/data` volume mount                                                                           | `volumes: None` in the app config, or no `-v bantam-data:/data` in the run command | Add a named persistent volume mounted at `/data`. Without it, the admin DB, manifest, and game SQLite files are wiped on every restart.                                                                                                               |
| Litestream config requires `LITESTREAM_REPLICA_URL` and the entrypoint refuses to boot if it's missing | `Error: LITESTREAM_REPLICA_URL must be an s3:// URL` in container logs             | Set `LITESTREAM_REPLICA_URL` (and the related `AWS_*` / `LITESTREAM_ENDPOINT` env vars) OR upgrade to a bantam image that handles empty backup config gracefully (writes an empty `dbs:` file and runs node directly without the litestream wrapper). |
| Entrypoint script uses `set -eu` and exits on the first failed subcommand                              | Any non-zero exit aborts the entrypoint before node starts                         | Make entrypoint steps tolerant of expected failures with `                                                                                                                                                                                            |     | true`, OR add the missing env vars/config so the step succeeds. |

### "Docs site (Vercel) shows 404 on every URL"

| Cause                                                                                                                           | How to confirm                                                               | Fix                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root directory is repo root, not `docs/`                                                                                        | Project settings → General → Root Directory = `docs`                         | PATCH `https://api.vercel.com/v9/projects/<projectId>` body `{"rootDirectory": "docs"}`. Triggers a redeploy.                                                                            |
| `astro check` fails because root tsconfig includes parent source files                                                          | CI fails at `astro check` step                                               | Add `docs/tsconfig.json` that extends `astro/tsconfigs/strict` and excludes `../src`, `../packages`, `../test`, `../scripts`, `../migrations`, `../openapi`, `../fixtures`, `../config`. |
| Vercel GitHub App integration put a token in env vars that broke the build                                                      | Inspect `Settings → Environment Variables`                                   | Rename / remove the stale var. Re-link the repo if the GitHub connection expired.                                                                                                        |
| Vercel project has `ssoProtection.deploymentType: "all_except_custom_domains"` or `"prod_deployment_urls_and_all_previews"` set | `GET https://api.vercel.com/v9/projects/<id>` shows `ssoProtection` non-null | `PATCH` with body `{"ssoProtection": null}`. 302-redirect-to-vercel.com-sso goes away.                                                                                                   |

### "Image pull fails with `unauthorized`"

The container registry (Docker Hub, ghcr.io, ECR) requires authentication that the orchestrator doesn't have. For Coolify, add a registry credential. For Docker Hub private images, the orchestrator needs a token with `read` scope. For ghcr.io, a GitHub PAT with `read:packages`.

### "GitHub Actions workflow shows empty jobs and the run name is the file path, not `CI`"

Classic YAML parse error. Common causes:

1. **Step name contains `:`** — YAML treats `:` as a mapping separator inside a scalar. `name: Build: container` will break parsing. Fix: use `-` or `:` outside the value (`name: Build container`).
2. **`set -eu` on Windows checkouts** — the runner clones into `D:\a\...` paths which contain `:`. CRLF line endings from Windows editors break the YAML. Fix: `git config core.autocrlf false` in repo, or add `.gitattributes` with `* text=auto eol=lf` for workflow files.
3. **Fake SHA pins** — committing step-pinned SHAs that don't exist (the original `actions/setup-node@xxx` placeholder SHAs from a template). Run `npx -y actionlint` to catch. Use `@v4` instead of fake SHAs.
4. **`secrets.DOCKERHUB_TOKEN` referenced in a job-level `if:`** — `secrets` context is not available in job-level `if`. Move the secret check to a step-level `if`, or check `secrets != ''` at the step level.

### "OpenAPI snapshot is stale"

The OpenAPI generator builds a one-game config and compares to `openapi/bantam.openapi.json`. New admin endpoints appear in the snapshot. `npm run openapi:generate` rewrites; `npm run openapi:check` validates.

### "Vercel CLI login as user `another-login` but you expected `bazokhan`"

The repo's `.git/config` had a stored user from a previous push. Two options:

1. Use the GitHub token directly: `git remote set-url origin "https://x-access-token:$(gh auth token)@github.com/...git"`.
2. Or, `gh repo set-default` to the correct repo. Or, use `git push https://github.com/...` over SSH.

## Quality gates (run before every push)

```bash
npm run format:check     # prettier
npm run lint              # eslint
npm run typecheck         # tsc --noEmit
npm test                  # vitest
npm run build             # tsc + sdk build
npm run openapi:check     # openapi snapshot drift
```

Then:

```bash
docker pull bazokhan/bantam:latest
docker run -d --rm --name bantam-smoke -p 13001:3000 -v bantam-smoke-data:/data bazokhan/bantam:latest
sleep 5 && curl -fsS -m 5 http://127.0.0.1:13001/healthz
curl -fsS -m 5 http://127.0.0.1:13001/readyz
docker rm -f bantam-smoke && docker volume rm bantam-smoke-data
```

If any gate fails, do not push. CI is not a substitute for local verification.

## Recovery recipes

### "I lost my admin password / need to re-register"

The admin DB is `/data/admin.sqlite`. Wipe it (with the service stopped):

```bash
docker stop bantam
rm /data/admin.sqlite       # inside the named volume
docker start bantam
```

The next visit to `/admin/register` reopens the first-admin registration flow.

### "I want to reset the manifest back to empty"

```bash
docker stop bantam
rm /data/games.json        # inside the named volume
docker start bantam
```

`/readyz` returns `{"status":"ready","games":[]}` again.

### "Litestream replica URL changed; restore a single game"

`BANTAM_RESTORE_IF_MISSING=true BANTAM_ONLY_GAME=<id>` on container start triggers a one-game restore. Combine with `LITESTREAM_REPLICA_URL`, `LITESTREAM_ENDPOINT`, `AWS_*` env vars so litestream can find the replica.

### "npm publish of @gamercury/bantam-sdk fails 401/403/404"

CI must use trusted publishing, not a token. A **404** or **ENEEDAUTH** on publish with `NODE_AUTH_TOKEN: XXXXX` in the step env is `actions/setup-node` `registry-url` writing `_authToken` and `always-auth=true`, so npm never starts OIDC. The publish step must rewrite that userconfig before `npm publish`. Local publish needs an org member with 2FA. Do not use a sibling `file:` path as a workaround. Fix: bind `npm trust github @gamercury/bantam-sdk --repo bazokhan/bantam --file publish-sdk.yml --allow-publish`, or from a terminal `npm login --auth-type=web` then `npm run sdk:publish`. Never publish `@gamercury/bantam` (server). Docs: `docs/src/content/docs/sdk.md`.

### "GitHub Actions publish-sdk skipped or 403 from OIDC"

The job lives in `.github/workflows/publish-sdk.yml` and only runs on tags `sdk-v*`, not on `main` or `v*` Docker tags. Tag must equal `packages/sdk/package.json` version (`sdk-v0.1.0` for `0.1.0`). The npm trusted publisher must name workflow filename `publish-sdk.yml` (not `ci.yml`), GitHub user `bazokhan`, repository `bantam`. Unvalidated trusts expire after 48 hours. Do not add `NPM_TOKEN` / `NODE_AUTH_TOKEN`.

## What this skill does NOT cover

- Auth provider secrets (PGS v2 client id/secret). See `docs/security.md`.
- Adapter authoring. See `docs/adapter-authoring.md`.
- Migrating to a new SQLite schema. The migration runner refuses destructive migrations by design — apply them offline.
