# Bantam documentation rules

- Reconcile every API, SDK, configuration, migration, backup, and command claim against `D:\Gamercury\bantam` before changing documentation.
- Run `npm run reference:check` and `npm run build` before calling the site complete.
- State local, tested, and production status separately. Never claim credentials, replication, deployment, recovery, or provider integration succeeded without evidence.
- Never commit credentials, player data, databases, environment dumps, internal host details, or private operational output.
- Preserve the single-writer SQLite boundary and the requirement that adapters derive authoritative values.
- Keep examples copyable, bounded, and explicit about destructive commands. Recovery examples must name one game and require the writer to be stopped.
- Do not add hosting configuration, analytics, remote repositories, or publication without explicit approval.
