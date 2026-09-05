-- @req FR-146 — LineOaAccount, the LINE OA Studio account aggregate (ADR-060):
-- one row per LINE Official Account a Business operates, many per Business,
-- exactly one Business each.
-- @spec ADR-060 D2, D3, D5, D11; BR-002; SEC-001
-- @tested tests/integration/fr146-line-oa-account.test.js
--
-- Additive only: one new table, its indexes, forced RLS and the same
-- private-application-table grant shape every table in this schema carries
-- (20260904090000_edge_device_credential_and_extraction_job.sql is the pattern).
-- Nothing existing is altered, renamed, dropped or rewritten. Idempotent: safe to
-- run more than once.
--
-- NOT APPLIED to production in this slice. Apply with the same procedure as
-- docs/runbooks/line-oa-provider-merge.md §4 (dry run in a rolled-back
-- transaction, then apply and record the version).

BEGIN;

CREATE TABLE IF NOT EXISTS "LineOaAccount" (
  "id"                      TEXT PRIMARY KEY,
  "code"                    TEXT NOT NULL,
  "tenantId"                TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"              TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "integrationConnectionId" TEXT NOT NULL REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bindingCode"             TEXT,
  "displayName"             TEXT NOT NULL,
  "basicId"                 TEXT,
  "status"                  TEXT NOT NULL DEFAULT 'DRAFT',
  "transportMode"           TEXT NOT NULL DEFAULT 'CLOUD',
  "isDefaultForBusiness"    BOOLEAN NOT NULL DEFAULT false,
  "botProfileJson"          TEXT NOT NULL DEFAULT '{}',
  "archivedAt"              TIMESTAMP(3),
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"                 INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "LineOaAccount_integrationConnectionId_key" ON "LineOaAccount"("integrationConnectionId");
CREATE UNIQUE INDEX IF NOT EXISTS "LineOaAccount_tenantId_code_key" ON "LineOaAccount"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "LineOaAccount_tenantId_bindingCode_key" ON "LineOaAccount"("tenantId", "bindingCode");
CREATE INDEX IF NOT EXISTS "LineOaAccount_businessId_status_idx" ON "LineOaAccount"("businessId", "status");

-- ── RLS and grants — private application table ──────────────────────────────
ALTER TABLE "LineOaAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineOaAccount" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineOaAccount' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "LineOaAccount" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "LineOaAccount" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "LineOaAccount" IS
  'FR-146 — LINE OA Studio account aggregate (ADR-060): one LINE Official Account operated by one Business; references a LINE_OA IntegrationConnection and the agent binding code; transportMode EDGE or CLOUD; LIVE is derived from the binding, never stored.';

COMMIT;
