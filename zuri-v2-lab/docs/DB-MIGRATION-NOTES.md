# Database Migration Notes — SQLite → PostgreSQL

| Field | Value |
|-------|-------|
| **Version** | 1.0.1 |
| **Status** | Approved |
| **Author** | Claude (build agent) |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-11 |

The MVP schema was designed to move to Postgres without semantic changes.

## What already migrates cleanly

- All enums are persisted as `String` + validated by Zod — swap to native Postgres
  enums later (optional) or keep text + CHECK constraints.
- UUID PKs are application-generated (`crypto.randomUUID` via Prisma `uuid()`)
  — no SQLite-specific identity.
- JSON columns are `String` in SQLite; change to `Json` type in Postgres and drop
  the stringify/parse layer incrementally (`safeParse` helpers isolate this).
- No SQLite-specific SQL is used anywhere (pure Prisma client API).

## Migration procedure (recommended)

1. Change `datasource db` provider to `postgresql`, set `DATABASE_URL`.
2. Optionally upgrade `String` JSON fields to `Json` and adjust the (small) JSON
   helper layer.
3. `prisma migrate dev` to generate the initial Postgres migration.
4. Move data by **domain-level export/import**, not file copy:
   - `GET /api/backup/export` on the SQLite instance → snapshot JSON,
   - `POST /api/backup/import {confirm:true}` on the Postgres instance
   (snapshot format is provider-agnostic).
5. Re-run the full test suite; integration tests are provider-independent.

## Cautions

- `AuditEvent` stream should be append-only in Postgres too (no updates/deletes;
  consider a DB-level rule).
- SQLite dates round-trip as ISO strings in snapshots; Prisma coerces on create —
  verified by the round-trip test.
- Do NOT copy `dev.db` into anything production — per INTEGRATION-MAP, migration
  is export → schema migration → import/reconciliation.
