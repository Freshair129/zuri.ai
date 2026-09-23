-- @req FR-094, FR-095, FR-096 — the canonical Person principal is server-owned
-- and must remain subject to the database row-security boundary.
-- @spec ADR-018 D5, ADR-045 D1-D6, SDD-052, SEC-018
-- @tested tests/unit/person-rls-hardening-migration.test.js
--
-- The earlier public-schema hardening migration enabled RLS on every public
-- table, but did not force it on Person. Keep this repair additive and
-- idempotent: no rows are rewritten and the runtime role's existing grant is
-- preserved.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE "Person" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Person" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "Person"
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
