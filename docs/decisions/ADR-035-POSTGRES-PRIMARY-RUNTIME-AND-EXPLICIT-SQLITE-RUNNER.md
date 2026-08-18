---
version: "0.2.0b"
created_at: "2026-08-19T00:00:00+07:00,ATHER"
last_update: "2026-08-19T06:30:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "data-platform"
  doc_type: "architecture-decision"
  scope: "Zuri application runtime database selection"
---

# ADR-035 — PostgreSQL primary runtime and explicit SQLite runner

**Status:** Accepted; runtime implementation complete; live Supabase mutation remains gated

**Risk:** HIGH — runtime persistence, generated clients, migration targeting and demo-seed safety

**Complexity:** C-3 — architecture, database boundary and operational safety

**Relates to:** FR-030, FR-046, NFR-007, SEC-008, SEC-011, ADR-016, ADR-018, ZV2-CR-009

## Context

The repository has two supported Prisma providers:

- `prisma/schema.prisma` and `@prisma/client` are the canonical SQLite local/test adapter;
- `prisma/schema.postgres.prisma` and `@zuri/prisma-postgres` are generated for PostgreSQL/Supabase.

`src/lib/db.js` already selects the provider-specific application client from the URL scheme.
The previous Windows runner did not load the ignored `.env` into its process, always fell back to
`file:./dev.db` when the parent shell had no `DATABASE_URL`, ran the SQLite `db:push` command and
seeded through the SQLite-only client. Making the URL PostgreSQL without changing those commands
would either fail at the provider boundary or make a demo seed an accidental production mutation.

## Decision

### D1 — Two explicit startup modes

| Runner | Authority | Startup contract |
|---|---|---|
| `run.bat` | PostgreSQL/Supabase from process environment or ignored `.env` | Load env process-locally, require a PostgreSQL URL, verify the application schema read-only, then start the app. Never run `db:push` or seed implicitly. |
| `run-local.bat` | local SQLite `dev.db` | Set `DATABASE_URL=file:./dev.db`, run the non-destructive local schema sync and idempotent demo seed, then start the app. |

The PostgreSQL runner is the default named runner. The SQLite runner remains available for offline
development, automated tests and local demo work; it is never inferred as a fallback by
`run.bat` when a PostgreSQL runtime is required.

### D2 — Provider-specific clients remain separate

The canonical schema remains SQLite and the generated PostgreSQL schema remains generated. The
application client selection in `src/lib/db.js` is retained. The seed entry point selects the same
provider-specific client, but PostgreSQL seeding requires the explicit
`ZURI_ALLOW_POSTGRES_SEED=1` opt-in and is not part of normal `run.bat` startup.

### D3 — Migration and schema mutation are explicit

The startup runner performs a read-only PostgreSQL connectivity/schema check. It does not call
`prisma db push`, `db execute`, `migrate deploy`, `db:reset` or any equivalent mutation against a
PostgreSQL URL. PostgreSQL schema deployment follows the reviewed Supabase migration history and
the procedure in `docs/DB-MIGRATION-NOTES.md`; a separate explicit operator command is required for
schema application.

Local-only commands (`db:push`, `db:clean`, `db:reset`) fail closed when `DATABASE_URL` is a
PostgreSQL URL. This prevents a SQLite schema command from becoming an accidental cloud operation.

### D4 — Connection roles and pooler modes

`DATABASE_URL` is the application runtime URL and should use the Supabase session pooler when the
runtime is an IPv4-only persistent Windows process. `DIRECT_URL` is reserved for migration/operator
commands. Neither URL is printed, committed, sent to the browser or used for MSP storage.

The existing `ZURI_LINE_DB_URL` Credential Manager path remains a separate, scope-bound LINE
runtime credential. It is not substituted for the Zuri application database URL.

`run.bat` does not enable `ZURI_LOCAL_DEMO_AUTH` for a PostgreSQL target. A developer may set
`ZURI_ALLOW_POSTGRES_LOCAL_DEMO=1` only for an explicitly approved non-production database; the
normal PostgreSQL runner therefore cannot silently expose the seeded-owner demo session.

### D5 — Data and production boundaries

This change does not copy `dev.db`, import a snapshot, alter Supabase RLS/roles, enable LINE, or
move MSP/GKS storage. Those remain governed by ADR-016, ADR-018 and the existing migration/change
records. A missing PostgreSQL schema is an explicit bootstrap failure with operator instructions,
not permission to mutate the target automatically.

## Acceptance criteria

- `run.bat` obtains the ignored `.env` process-locally without logging secret values.
- `run.bat` refuses a missing/non-PostgreSQL application URL and verifies required application tables
  with a read-only query before starting Next.js.
- `run.bat` never invokes `db:push` or `db:seed` implicitly for PostgreSQL.
- `run-local.bat` preserves the existing SQLite demo workflow.
- `db:push`, `db:clean` and `db:reset` refuse PostgreSQL URLs.
- `db:seed` is provider-aware and refuses PostgreSQL unless the explicit seed opt-in is present.
- `run.bat` does not enable the local demo session unless the separate PostgreSQL local-demo opt-in
  is present.
- Unit tests cover runner mode selection, secret-safe env loading, provider-aware seed selection and
  local-command guards; live Supabase verification remains a separately reported gate.
- `npm test`, `npm run build` and `npm run govern` pass with no stale generated documentation.

## Rollback

For local work, use `run-local.bat`. For an application rollback, revert the runtime branch and
restart with the previous runner only after reviewing the environment target. No database rollback
is part of this ADR because the default path performs no PostgreSQL mutation.

## Out of scope

- applying or rewriting already-applied Supabase migrations;
- snapshot export/import or production data reconciliation;
- changing tenant/RLS/role policy;
- enabling LINE production traffic;
- moving MSP, GKS or GenesisBlockDB into the Zuri database; and
- replacing the canonical SQLite schema with a hand-edited PostgreSQL schema.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-19 | beta | Owner-approved PostgreSQL primary runtime boundary with explicit SQLite runner | working-tree | ATHER |
| 0.2.0b | 2026-08-19 | beta | Runtime implementation complete; PostgreSQL local-demo capability remains explicit | working-tree | ATHER |
