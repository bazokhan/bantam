# Bantam engineering rules

- Treat authentication, adapter validation, migrations, and backup recovery as release-critical boundaries.
- Define request and response schemas before adding routes. Reject unknown input; never log bodies, credentials, tokens, raw provider IDs, IP addresses, or unredacted headers.
- Clients may submit evidence only. Every leaderboard value must be derived by a versioned server adapter inside the run transaction.
- Keep SQLite transactions explicit and short. Never perform network or filesystem operations inside a database transaction. One live writer process owns each database.
- Never edit an applied migration. Add a new ordered migration, retain checksum validation, and test both fresh install and upgrade.
- Deterministic adapter changes require regenerated golden fixtures (where the adapter ships its own) and tampering regressions. Cross-repo contract checks run only when an associated sibling adapter repository is available in this checkout.
- Run format check, lint, typecheck, unit/integration tests, OpenAPI drift check, production build, container smoke, and backup/restore before calling a release ready. A skipped required lane is a blocker.
- Secrets belong in environment variables or the deployment secret store. Never commit `.env`, service-account JSON, OAuth secrets, S3 credentials, raw deployment dumps, database files, or restored player data.
- Restore commands must target one validated game. Never overwrite an existing database without an explicit `--force` recovery invocation while the service is stopped.
- Do not create remotes, deploy, publish packages, or claim external success without explicit approval and evidence.
- This server is game-agnostic. No specific game is wired in by default; game-specific adapters live in their own sibling repositories. The only built-in adapter is the synthesized "generic" form for trivial games.
- Documentation lives in `docs/` (Astro Starlight). Build it with `npm run docs:build`. Not shipped from runtime container.
