-- @req FR-153 — LineOaLiffApp: the LIFF app registry of one LINE OA Studio
-- account (SRS LOS-RQ-070): name, view size, endpoint, scopes, bot prompt, and
-- the external liffId LINE Developers issued, recorded by a publisher as an
-- attribute (BR-002). Nothing here calls LINE; a rich menu LIFF action resolves
-- through an ACTIVE row to https://liff.line.me/{liffId}.
-- @spec BR-002; SEC-001; ADR-060 D6, D11
-- @tested tests/integration/fr153-line-oa-liff-app.test.js
--
-- Additive only: one new table, its indexes, foreign keys, forced RLS and the
-- same private-application-table grant shape every table in this schema
-- carries (20260906150000_line_oa_rich_menu.sql is the pattern). Nothing
-- existing is altered, renamed, dropped or rewritten. Idempotent: safe to run
-- more than once. Timestamp chosen after checking the directory for a
-- collision (tests/unit/migration-version-uniqueness.test.js guards it).
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "LineOaLiffApp" (
  "id"              TEXT PRIMARY KEY,
  "code"            TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"      TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "lineOaAccountId" TEXT NOT NULL REFERENCES "LineOaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "viewSize"        TEXT NOT NULL DEFAULT 'FULL',
  "endpointUrl"     TEXT NOT NULL,
  "scopesJson"      TEXT NOT NULL DEFAULT '[]',
  "botPrompt"       TEXT NOT NULL DEFAULT 'NORMAL',
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "externalLiffId"  TEXT,
  "archivedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"         INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "LineOaLiffApp_tenantId_code_key" ON "LineOaLiffApp"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "LineOaLiffApp_lineOaAccountId_externalLiffId_key" ON "LineOaLiffApp"("lineOaAccountId", "externalLiffId");
CREATE INDEX IF NOT EXISTS "LineOaLiffApp_lineOaAccountId_status_idx" ON "LineOaLiffApp"("lineOaAccountId", "status");

-- ── RLS and grants — private application table ──────────────────────────────
ALTER TABLE "LineOaLiffApp" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineOaLiffApp" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineOaLiffApp' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "LineOaLiffApp" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "LineOaLiffApp" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "LineOaLiffApp" IS
  'FR-153 — LIFF app registry of one LINE OA Studio account: name, view size, endpoint, scopes, bot prompt; externalLiffId is an attribute recorded by a publisher (BR-002); no secret stored.';

COMMIT;
