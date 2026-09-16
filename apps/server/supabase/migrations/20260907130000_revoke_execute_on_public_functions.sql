-- @req SEC-003, SEC-001 — close the remaining default grant in `public`.
-- @spec ADR-056, ADR-057; docs/DB-MIGRATION-NOTES.md §Migration discipline
-- @tested tests/unit/service-role-grant-baseline.test.js
--
-- 20260906235000 took `public`'s tables and sequences back from service_role
-- and altered the `postgres`-owned default privileges so the next CREATE TABLE
-- would not reopen the hole. It did not cover functions. `pg_default_acl` still
-- carries, under the same `postgres` grantor, an entry granting EXECUTE on every
-- future function in this schema to anon, authenticated and service_role.
--
-- Measured on production 2026-09-07 immediately before writing this file:
--
--   functions in schema public            : 0
--   pg_default_acl type 'f' (postgres)    : anon=X authenticated=X service_role=X
--   service_role : 0 table grants, rolbypassrls = true, rolcanlogin = false
--   anon         : 0 table grants, rolbypassrls = false
--   authenticated: 0 table grants, rolbypassrls = false
--   zuri_app_runtime : 121 table grants, rolbypassrls = false  ← the app's role
--
-- Because there are no functions yet, this migration changes nothing that is
-- reachable today. It changes what happens the first time somebody adds one.
--
-- ── One correction to the earlier migration's claim ─────────────────────────
-- 20260906235000 ends with `REVOKE USAGE ON SCHEMA public FROM service_role`,
-- which reads as though the role can no longer enter the schema at all. It
-- cannot revoke what the role does not hold directly: `public`'s ACL is
--
--   pg_database_owner=UC/pg_database_owner  =U/pg_database_owner  postgres=U/…
--
-- and that bare `=U` is the grant to PUBLIC. Every role inherits USAGE from it,
-- so `has_schema_privilege('service_role','public','USAGE')` is still true.
-- The table revokes still hold — those were direct grants — but the schema-level
-- line was a no-op, and the EXECUTE default this file removes was therefore
-- genuinely reachable rather than merely recorded.
--
-- Why EXECUTE matters more for service_role than the role list suggests: it has
-- BYPASSRLS. A SECURITY INVOKER function added later and called by that role
-- reads through every policy on every table it touches, which is the same
-- exposure the table grants had, arriving by a different door.
--
-- anon and authenticated are revoked alongside it. Neither holds a single table
-- grant, this application reaches Postgres only through DATABASE_URL as
-- `zuri_app_runtime`/`postgres`, and it uses no PostgREST RPC — so an EXECUTE
-- default for either is a standing grant with no caller. A future function
-- genuinely meant for a client can be granted explicitly, which is the point:
-- the grant becomes a decision in a migration rather than a default nobody read.
--
-- The `supabase_admin`-owned type 'f' entry is deliberately left alone, for the
-- same reason 20260906235000 left its table twin alone: it governs objects
-- supabase_admin creates, this migration does not run as that role, and nothing
-- in this repository creates functions that way.
--
-- Scope: schema `public`, object type FUNCTIONS, roles service_role, anon and
-- authenticated. No table, column, index, policy, RLS flag or other schema is
-- touched. Idempotent — revoking a privilege already absent is a no-op.
--
-- REVERSIBLE. To restore exactly what was there:
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
--
-- NOT APPLIED by the change that writes it. Applying is an owner-instructed
-- operator step (ADR-057): dry run in a rolled-back transaction, confirm the
-- default ACL loses exactly these three grants and nothing else moves, apply,
-- record the version, then confirm `/api/health` still reports db:ok and that
-- every model still reads.

BEGIN;

-- Future functions: the entry that is actually load-bearing, since `public`
-- holds none today.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;

-- Existing functions: a no-op at 0 functions, kept so the file states the whole
-- intent and stays correct if one lands between review and apply.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

COMMIT;
