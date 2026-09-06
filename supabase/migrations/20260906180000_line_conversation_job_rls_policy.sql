-- @req FR-149, SEC-001 — give "LineConversationJob" the same private-table
-- posture every other public table already has. The FR-149 migration
-- (20260906160000_server_line_jobs) created the table and its indexes but
-- omitted the security block its sibling "LineOaAccount" carries, so on
-- production the table landed with row security ENABLED and **no policy**.
-- @spec ADR-061, ADR-056 — the block below is copied from
--   20260905120000_line_oa_account.sql; this file adds nothing new, it repairs
--   an omission.
-- @tested tests/unit/schema-migration-drift.test.js
--
-- Measured on production 2026-09-06 immediately after 20260906160000 applied:
--
--   LineConversationJob : rls=true  forced=false  policies=0  indexes=6
--   LineOaAccount       : rls=true  forced=true   policies=1  (zuri_app_runtime_all)
--   every other public table (83 of 83) : exactly one zuri_app_runtime_all policy
--
-- Why it matters even though nothing is broken today. Row security with no
-- policy denies every row to every role that is not the owner and does not hold
-- BYPASSRLS. The application currently connects as `postgres`, which is both,
-- so the table works — and would stop working the moment the runtime moves to
-- `zuri_web_login`, which is the direction this schema is built for
-- (`zuri_app_runtime` already holds SELECT/INSERT/UPDATE/DELETE here, and every
-- policy in the database names that role). The queue would fail closed on its
-- first read, on the change that is supposed to make the deployment safer.
--
-- The REVOKE is part of the same standard block, not extra scope: this table
-- landed with all seven privileges granted to `service_role`, which carries
-- BYPASSRLS, while its sibling has none. It holds LINE conversation content —
-- answerText, recipientId, sourceUserId. Every table created since the
-- 2026-08-21 hardening revokes that grant on the line quoted above; this one
-- did not. (The wider question — 52 older tables still carry the same grant,
-- and Supabase default privileges keep re-granting it on every new table — is
-- deliberately NOT addressed here. It needs its own change.)
--
-- Idempotent: ENABLE/FORCE are no-ops when already set, the policy is created
-- only when absent, and REVOKE of an absent privilege does nothing.
--
-- NOT APPLIED by the change that writes it — owner-instructed operator step
-- (ADR-057). Dry run in a rolled-back transaction, apply, record the version,
-- then confirm /api/health still reports db:ok.

BEGIN;

ALTER TABLE "LineConversationJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineConversationJob" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineConversationJob' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "LineConversationJob" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "LineConversationJob" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "LineConversationJob" IS
  'FR-149 — durable LINE conversation admission and send ledger (ADR-061): one row per admitted inbound event, leased for execution and for a single fenced send. Private application table: policy zuri_app_runtime_all, no Data API role.';

COMMIT;
