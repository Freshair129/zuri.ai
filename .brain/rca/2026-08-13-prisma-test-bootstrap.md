# RCA — Prisma schema-engine failure in the Vitest bootstrap

**Date:** 2026-08-13
**Scope:** `tests/global-setup.js` and the local SQLite test database

## Symptom

`npm test` stopped before collecting any tests with `Error: Schema engine error:`
from `npx prisma db push --skip-generate`.

## Evidence

- `npx prisma validate` passed for `prisma/schema.prisma`.
- The same schema-engine command failed repeatedly with an empty `RUST_LOG`.
- The command succeeded repeatedly when `RUST_LOG=info` (and with `RUST_LOG=debug`).
- The failure reproduced with fresh SQLite database paths and did not depend on FR-040
  application code or a Prisma schema edit.
- The failing child process was invoked by `tests/global-setup.js:12` before test
  collection.

## Root Cause

The local Prisma 5.22 schema-engine process is incompatible with the repository's
Node 24 / Windows bootstrap when started without a Rust logging mode. The engine
terminates during the silent startup path; enabling a deterministic `RUST_LOG` mode
keeps the engine's Windows IPC/bootstrap path alive and allows the schema push to
complete.

## Why the issue escaped detection

The bootstrap relied on Prisma's default environment and treated a generic child
process failure as a schema failure. The project had no preflight probe for the
Node/Prisma/Windows combination, and the focused FR-040 suite intentionally bypassed
the global database setup.

## Implemented prevention

`tests/global-setup.js` now sets a deterministic supported Rust logging mode for the
test schema-push child process (`info` by default; `debug`/`trace` overrides remain
valid). `prisma validate` and the full `npm test` command remain in the verification
gate so a future engine/toolchain change is detected before feature release.
