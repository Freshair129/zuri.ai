-- @req SEC-003, SEC-001 — take the application schema back from `service_role`.
-- @spec ADR-056, ADR-057; docs/DB-MIGRATION-NOTES.md §Migration discipline
-- @tested tests/unit/service-role-grant-baseline.test.js
--
-- Measured on production 2026-09-06 immediately before writing this file:
--
--   service_role : rolbypassrls = true, rolcanlogin = false, rolsuper = false
--   public       : 52 of 88 tables grant it SELECT, INSERT, UPDATE, DELETE,
--                  TRUNCATE, REFERENCES and TRIGGER
--   policies naming service_role : 0 — and none is needed, because BYPASSRLS
--                  precedes policies entirely
--   "AuditEvent" : DELETE and TRUNCATE among them
--
-- That last line is the sharp one. SEC-003 states AuditEvent is append-only for
-- every significant mutation, and the grant contradicts the requirement in the
-- one place the system relies on for after-the-fact truth.
--
-- Why the grant is not needed. This application reaches Postgres only through
-- DATABASE_URL / ZURI_LINE_DB_URL. It never uses PostgREST or a Supabase client
-- key against `public`. The one service-role credential in the deployment,
-- SUPABASE_STORAGE_SERVICE_ROLE_KEY, is for Storage — the `storage` schema,
-- whose 7 grants this file does not touch, along with realtime (2) and vault
-- (2). Revoking `public` removes a path nothing here uses and closes one any
-- holder of that key could use to read or delete business data.
--
-- The 36 tables created since the 2026-08-21 hardening already carry an
-- explicit `REVOKE ... FROM service_role` in their own migrations and are
-- unaffected. The 52 predate that habit.
--
-- ── The default privileges are the actual leak ──────────────────────────────
-- Revoking the 52 alone would fix nothing durable: `pg_default_acl` carries an
-- entry owned by `postgres` that grants service_role `arwdDxtm` on every future
-- table in this schema, which is why LineConversationJob arrived on 2026-09-06
-- with all seven privileges despite the hardening. Every table this repository
-- creates is created by `postgres`, so altering that default is what stops the
-- next one. A second entry owned by `supabase_admin` is deliberately left
-- alone: it governs objects supabase_admin creates, this migration does not run
-- as that role, and nothing in this repository creates tables that way.
--
-- Scope: schema `public`, role `service_role`. No table, column, index, policy,
-- RLS flag, other role or other schema is touched. Idempotent — revoking a
-- privilege already absent is a no-op, so re-running changes nothing.
--
-- REVERSIBLE. To restore exactly what was there:
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
--   GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
--   GRANT USAGE ON SCHEMA public TO service_role;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
--
-- NOT APPLIED by the change that writes it. Applying is an owner-instructed
-- operator step (ADR-057): dry run in a rolled-back transaction, confirm the
-- affected count, apply, record the version, then confirm `/api/health` still
-- reports db:ok and that every model still reads — the application does not use
-- this role, and those checks are how that claim gets tested rather than
-- asserted.

BEGIN;

-- Future tables first: without this the next CREATE TABLE re-opens the hole.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM service_role;

-- Then the 52 that already carry it.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM service_role;
REVOKE USAGE ON SCHEMA public FROM service_role;

COMMIT;
