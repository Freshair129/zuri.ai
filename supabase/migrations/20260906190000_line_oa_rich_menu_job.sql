-- RENUMBERED 2026-09-06 from 20260906180000, which 20260906180000_line_conversation_job_rls_policy
-- already held and had already been applied and receipted on production. The
-- collision is invisible to git — two files, different names — and fatal to any
-- tool keyed on version: `supabase db push` reads 20260906180000 as applied and
-- skips whichever file it did not run. This file's DDL WAS applied to production
-- on 2026-09-06 (all three LineOaRichMenu* tables exist, with the full security
-- block and 22 columns on the job table), but its receipt could not be written
-- under a version another migration owned, so the lineage did not name it.
-- Applying this renumbered file is therefore a no-op that records what is
-- already true — every statement is IF NOT EXISTS or guarded.
--
-- @req FR-152 — LineOaRichMenuJob: the server-owned rich menu publish ledger
-- of LINE OA Studio (ADR-061 D1, D6, D7). One row per unit of work against
-- LINE — PUBLISH a frozen LineOaRichMenuVersion (create the menu, upload the
-- image), SET_DEFAULT or SET_ALIAS a published one — claimed by the server
-- worker with compare-and-set and a bounded lease. An ambiguous create ends
-- UNKNOWN for an operator; idempotent stages retry with backoff. Holds no
-- secret: the worker resolves the account credential per attempt from the
-- deployment secret mount.
-- @spec ADR-061 D1, D6, D7, D8; SEC-001; BR-002
-- @tested tests/integration/fr152-line-oa-rich-menu-jobs.test.js
--
-- Additive only: one new table, its indexes, foreign keys, forced RLS and the
-- same private-application-table grant shape every table in this schema
-- carries (20260906150000_line_oa_rich_menu.sql is the pattern). Nothing
-- existing is altered, renamed, dropped or rewritten. Idempotent: safe to run
-- more than once.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "LineOaRichMenuJob" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "businessId"         TEXT NOT NULL,
  "accountId"          TEXT NOT NULL REFERENCES "LineOaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "richMenuId"         TEXT NOT NULL REFERENCES "LineOaRichMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "richMenuVersionId"  TEXT NOT NULL REFERENCES "LineOaRichMenuVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind"               TEXT NOT NULL,
  "stage"              TEXT NOT NULL DEFAULT 'CREATE',
  "status"             TEXT NOT NULL DEFAULT 'QUEUED',
  "transportEpoch"     INTEGER NOT NULL,
  "attempts"           INTEGER NOT NULL DEFAULT 0,
  "availableAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  "expiresAt"          TIMESTAMP(3) NOT NULL,
  "claimantId"         TEXT,
  "leaseExpiresAt"     TIMESTAMP(3),
  "externalRichMenuId" TEXT,
  "providerRequestId"  TEXT,
  "errorCode"          TEXT,
  "correlationId"      TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"            INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS "LineOaRichMenuJob_status_availableAt_idx" ON "LineOaRichMenuJob"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "LineOaRichMenuJob_accountId_status_idx" ON "LineOaRichMenuJob"("accountId", "status");
CREATE INDEX IF NOT EXISTS "LineOaRichMenuJob_richMenuId_status_idx" ON "LineOaRichMenuJob"("richMenuId", "status");

-- ── RLS and grants — private application table ──────────────────────────────
ALTER TABLE "LineOaRichMenuJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineOaRichMenuJob" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineOaRichMenuJob' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "LineOaRichMenuJob" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "LineOaRichMenuJob" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "LineOaRichMenuJob" IS
  'FR-152 — server-owned rich menu publish ledger (ADR-061): PUBLISH / SET_DEFAULT / SET_ALIAS jobs claimed with compare-and-set and a lease; externalRichMenuId is an attribute (BR-002); no secret stored.';

COMMIT;
