-- @req FR-151 — LineOaRichMenu and LineOaRichMenuVersion: the rich menu
-- designer's data for one LINE OA Studio account (ADR-060 D3). A menu is the
-- identity, alias and default flag; a version is one numbered body — layout,
-- chat-bar text, tap areas and their actions, the FileAsset image it was
-- designed against — editable while DRAFT and immutable once FROZEN. The
-- external richMenuId LINE assigns at deployment is recorded on the version as
-- an attribute (BR-002), by the transport lane in a later slice.
-- @spec ADR-060 D3, D6, D11; BR-002; SEC-001
-- @tested tests/integration/fr151-line-oa-rich-menu.test.js
--
-- Additive only: two new tables, their indexes, foreign keys, forced RLS and
-- the same private-application-table grant shape every table in this schema
-- carries (20260905120000_line_oa_account.sql is the pattern). Nothing
-- existing is altered, renamed, dropped or rewritten. Idempotent: safe to run
-- more than once.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "LineOaRichMenu" (
  "id"              TEXT PRIMARY KEY,
  "code"            TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"      TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "lineOaAccountId" TEXT NOT NULL REFERENCES "LineOaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"            TEXT NOT NULL,
  "alias"           TEXT,
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "isDefault"       BOOLEAN NOT NULL DEFAULT false,
  "archivedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"         INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "LineOaRichMenu_tenantId_code_key" ON "LineOaRichMenu"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "LineOaRichMenu_lineOaAccountId_alias_key" ON "LineOaRichMenu"("lineOaAccountId", "alias");
CREATE INDEX IF NOT EXISTS "LineOaRichMenu_lineOaAccountId_status_idx" ON "LineOaRichMenu"("lineOaAccountId", "status");

CREATE TABLE IF NOT EXISTS "LineOaRichMenuVersion" (
  "id"                 TEXT PRIMARY KEY,
  "richMenuId"         TEXT NOT NULL REFERENCES "LineOaRichMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tenantId"           TEXT NOT NULL,
  "businessId"         TEXT NOT NULL,
  "lineOaAccountId"    TEXT NOT NULL,
  "versionNumber"      INTEGER NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'DRAFT',
  "layout"             TEXT NOT NULL,
  "chatBarText"        TEXT NOT NULL,
  "selected"           BOOLEAN NOT NULL DEFAULT false,
  "imageFileAssetId"   TEXT REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "imageWidth"         INTEGER NOT NULL,
  "imageHeight"        INTEGER NOT NULL,
  "areasJson"          TEXT NOT NULL DEFAULT '[]',
  "externalRichMenuId" TEXT,
  "frozenAt"           TIMESTAMP(3),
  "publishedAt"        TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "LineOaRichMenuVersion_richMenuId_versionNumber_key" ON "LineOaRichMenuVersion"("richMenuId", "versionNumber");
CREATE INDEX IF NOT EXISTS "LineOaRichMenuVersion_lineOaAccountId_status_idx" ON "LineOaRichMenuVersion"("lineOaAccountId", "status");

-- ── RLS and grants — private application tables ─────────────────────────────
ALTER TABLE "LineOaRichMenu" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineOaRichMenu" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LineOaRichMenuVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineOaRichMenuVersion" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineOaRichMenu' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "LineOaRichMenu" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineOaRichMenuVersion' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "LineOaRichMenuVersion" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "LineOaRichMenu" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "LineOaRichMenuVersion" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "LineOaRichMenu" IS
  'FR-151 — rich menu of one LINE OA Studio account (ADR-060 D3): identity, alias, default flag; bodies live in LineOaRichMenuVersion.';
COMMENT ON TABLE "LineOaRichMenuVersion" IS
  'FR-151 — one numbered rich menu body: layout, chat-bar text, tap areas, FileAsset image; immutable once FROZEN; externalRichMenuId is an attribute set by the transport lane (BR-002).';

COMMIT;
