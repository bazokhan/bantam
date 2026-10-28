# Bantam engineering rules

- Treat authentication, adapter validation, migrations, and backup recovery as release-critical boundaries.
- Define request and response schemas before adding routes. Reject unknown input; never log bodies, credentials, tokens, raw provider IDs, IP addresses, or unredacted headers.
- Clients may submit evidence only. Every leaderboard value must be derived by a versioned server adapter inside the run transaction.
- Keep SQLite transactions explicit and short. Never perform network or filesystem operations inside a database transaction. One live writer process owns each database.
- Never edit an applied migration. Add a new ordered migration, retain checksum validation, and test both fresh install and upgrade.
- Deterministic adapter changes require regenerated golden fixtures (where the adapter ships its own) and tampering regressions. Cross-repo contract checks run only when an associated sibling adapter repository is available in this checkout.
- Run format check, lint, typecheck, unit/integration tests, OpenAPI drift check, production build, container smoke, and backup/restore before calling a release ready. A skipped required lane is a blocker.
- The admin console is a React SPA in `packages/admin-ui`, served at `/admin/console/` by the Fastify server. Its JSON API is `src/admin/api.ts` under `/admin/api/*`; schemas live in `src/admin/api-schemas.ts`. The server-rendered pages stay at `/admin/legacy` as a no-JavaScript fallback.
- The console's wire types are derived from the server's TypeBox schemas (`packages/admin-ui/src/lib/types.ts` imports them via the `@server/*` path alias). Change the schema, not the client's copy — a hand-written duplicate is a silent runtime bug, not a type error.
- Secrets belong in environment variables or the deployment secret store. Never commit `.env`, service-account JSON, OAuth secrets, S3 credentials, raw deployment dumps, database files, or restored player data. Never write secret values into docs, skills, or commit messages.
- Restore commands must target one validated game. Never overwrite an existing database without an explicit `--force` recovery invocation while the service is stopped.
- Do not create remotes, deploy, publish packages, or claim external success without explicit approval and evidence.
- The only npm publish target is `@gamercury/bantam-sdk` (`packages/sdk`, public). Never publish the server package `@gamercury/bantam`. Workflow: `docs/src/content/docs/sdk.md`. CI publishes on tags `sdk-v*` from `.github/workflows/publish-sdk.yml` via npm trusted publishing (GitHub user `bazokhan`, no org, no `NPM_TOKEN`). Local fallback: `npm run sdk:publish` with 2FA.
- This server is game-agnostic. No specific game is wired in by default; game-specific adapters live in their own sibling repositories. The only built-in adapter is the synthesized "generic" form for trivial games.
- Documentation lives in `docs/` (Astro Starlight). Build it with `npm run docs:build`. Not shipped from runtime container.
- Game-wiring agents must load `.agents/skills/bantam/SKILL.md`. Games install the client with `npm install @gamercury/bantam-sdk` (public registry), not a sibling `file:` path. Install this skill with `npx skills add bazokhan/bantam --skill bantam`. The skill documents **paths and env var names only** — never copy secrets into it.
