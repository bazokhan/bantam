---
title: Versioning and changelog
description: Service, API, adapter, schema, and documentation versions.
---

## Version policy

- Service releases use semantic versions.
- Compatible API additions are minor; incompatible HTTP or SDK changes require a major release and migration guide.
- Adapter IDs and rule versions are immutable contracts. Result-changing rules use a new version.
- Database migrations are monotonic and checksummed. They are not tied one-to-one to the service version.
- Documentation snapshots must pass OpenAPI reconciliation for the release commit.

## 0.1.0 — local foundation

- Multi-title Fastify service with isolated WAL databases and safe migrations.
- PGS v2 and development authentication providers with rotating Bantam sessions.
- Higher/lower permanent and daily boards, ranks, pagination, surrounding results, idempotency, deletion, and rate limits.
- Game-agnostic adapter contract: file-based loaders from a mounted directory plus a synthesized `generic` adapter for trivial games.
- Token-gated read-only admin UI.
- Litestream/MinIO local replication and guarded recovery commands.
- Typed TypeScript SDK, OpenAPI snapshot, tests, container, Compose, CI, and this Starlight site.

This entry describes local implementation only. It does not claim a remote repository, production credentials, cloud bucket, Coolify deployment, PGS validation, or external release.

## 0.1.0 — production wiring

- Source published to a private GitHub repository at <https://github.com/bazokhan/bantam>.
- Container image published to Docker Hub as [`bazokhan/bantam`](https://hub.docker.com/r/bazokhan/bantam). CI publishes the `latest` tag plus the short commit SHA on every push to `main`, and a versioned tag on each `v*` release tag.
- Documentation site deployed to <https://bantam.trugraph.io> via Vercel, auto-deployed from `docs/` on every push to `main`.
- Featured under the **Projects** section on <https://gamercury.trugraph.io/projects/bantam>.
- Repository and image references in the docs were updated from the placeholder `gamercury/bantam` namespace to the live `bazokhan/bantam` namespace.
