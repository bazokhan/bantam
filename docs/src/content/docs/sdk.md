---
title: SDK on npm
description: Install @gamercury/bantam-sdk from the public registry, and how maintainers publish it.
---

Games consume Bantam through the public npm package **`@gamercury/bantam-sdk`**. Do not use a sibling `file:` path, git submodule, or copied `BantamClient` source. The server package `@gamercury/bantam` stays **private** and is never published; games talk to a running Bantam container over HTTP.

## Install (any game)

```bash
npm install @gamercury/bantam-sdk
```

```ts
import { BantamClient, BrowserStorage } from "@gamercury/bantam-sdk";

const bantam = new BantamClient({
  baseUrl: "https://bantam-api.example",
  gameId: "my-game",
  storage: new BrowserStorage(),
});
```

Vite, webpack, and Capacitor WebViews bundle the client into the game. Players do not run npm. CI for a game must be able to `npm ci` from registry.npmjs.org — no checkout of this repository is required.

## Feature flags

```ts
const flags = await bantam.getFlags();
// [{ key: "daily_challenge", enabled: true, value: null }, ...]

if (await bantam.isEnabled("daily_challenge")) enableDailyMode();

const season = flags.find((f) => f.key === "season_badge" && f.enabled)?.value ?? "s1";
```

`getFlags()` sends the session automatically when one exists, so partial rollouts resolve per player. Called signed out, it still returns fully-rolled-out flags — gameplay must never depend on login succeeding. `isEnabled(key, fallback)` returns `fallback` (default `false`) when the flag is missing or the request fails, so a down API does not take down gameplay. Flags are operator-controlled and read-only from the client. See [API and SDK](/reference/) for rollout semantics.

API details: [API and SDK](/reference/). Adapter files still live in the **game** repo and are mounted on the server; they are not on npm.

## What gets published

| Package                 | Registry      | Notes                                                      |
| ----------------------- | ------------- | ---------------------------------------------------------- |
| `@gamercury/bantam-sdk` | public npm    | `packages/sdk` only (`dist/` + license)                    |
| `@gamercury/bantam`     | not published | server stays private; ship `bazokhan/bantam` on Docker Hub |

## Maintainer publish — trusted publishing (no token)

CI publishes with **npm trusted publishing** over GitHub Actions OIDC. There is no `NPM_TOKEN`. A GitHub **organization is not required**: npm's "Organization or user" field is the GitHub **username**.

Bind the package once (account with 2FA and write access to `@gamercury/bantam-sdk`, npm CLI 11.15+):

```bash
npm trust github @gamercury/bantam-sdk --repo bazokhan/bantam --file publish-sdk.yml --allow-publish -y
```

That filename must match `.github/workflows/publish-sdk.yml` exactly (basename only). Do not point the trusted publisher at `ci.yml`. An unvalidated trust expires in 48 hours until the first successful CI publish.

Then bump `packages/sdk/package.json` `version` (incompatible HTTP/SDK changes are a **major**), verify, and tag:

```bash
git tag sdk-v0.2.0
git push origin sdk-v0.2.0
```

The tag **must** match `packages/sdk/package.json` (`sdk-v` + semver). Workflow `publish-sdk.yml` runs `npm run verify` and `npm publish -w @gamercury/bantam-sdk --access public` with `id-token: write`. Provenance is attached automatically when the GitHub repo is public; a private repo still publishes, without provenance.

Do not create a granular npm token for CI. Do not set `NODE_AUTH_TOKEN` on this workflow. `actions/setup-node` `registry-url` writes `_authToken` and `always-auth=true`; either one makes npm skip OIDC (`404` or `ENEEDAUTH`). The publish step overwrites that userconfig before `npm publish`.

### Why not CircleCI or GitLab

npm also trusts CircleCI cloud (including its Free plan) and GitLab.com shared runners. CircleCI needs org/project/pipeline UUIDs and **does not attach provenance**. This repo already runs GitHub Actions. Do not add a second CI just to avoid a GitHub org that was never required.

### Local fallback (2FA, emergencies)

Local `npm publish` still needs an org member with 2FA. From the Bantam repo root, after `npm run verify`:

```bash
npm login --auth-type=web --scope=@gamercury --registry https://registry.npmjs.org/
npm whoami
npm run sdk:publish:dry
npm run sdk:publish
```

`sdk:publish` only runs `npm publish -w @gamercury/bantam-sdk --access public`. Local `npm publish` from the **repo root** without `-w` is forbidden: the root package is `"private": true`. Finish CLI 2FA in a local terminal (the 2FA URL is a secret). Prefer the `sdk-v*` tag path for routine releases.

## First-time org checklist

- Org [gamercury](https://www.npmjs.com/org/gamercury) exists. Add the publishing user as a member with permission to publish public packages.
- First scoped public publish needs `publishConfig.access: public` (already set on the SDK package).
- Configure the GitHub trusted publisher (command above) after the package exists on npm.
- Confirm `npm view @gamercury/bantam-sdk version` after a successful publish or staged-release approval.

## See also

- Source: `packages/sdk` in <https://github.com/bazokhan/bantam>
- Docker image (the server): [`bazokhan/bantam`](https://hub.docker.com/r/bazokhan/bantam)
- npm trusted publishers: <https://docs.npmjs.com/trusted-publishers/>
