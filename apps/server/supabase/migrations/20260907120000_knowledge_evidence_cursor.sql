-- @req FR-110 — KnowledgeEvidenceCursor: zuri-ai's own cursor into GKS's
-- gks_stage_evidence_export, one row per KnowledgeScope pulled (ADR-068 D2).
-- Cursor ownership is the puller's — the same division FR-100's decision
-- export already uses, with the roles reversed — and the row advances only
-- after a page's FR-071 ledger writes have committed, so a crash mid-page
-- replays from the last durable cursor and the receiver's idempotency makes
-- the replay a no-op. Not a ledger table (ADR-050 D4 keeps the ledger at the
-- six Pipeline* tables); integration-lane bookkeeping for a scheduled pull.
-- @spec ADR-068; ADR-050 D3; SDD-057; SEC-001
-- @tested tests/integration/fr110-knowledge-evidence-importer.test.js
--
-- Additive only: one new table, its indexes, forced RLS and the same
-- private-application-table grant shape every table in this schema carries
-- (20260906235500_crm_sales_task.sql is the pattern). Nothing existing is
-- altered, renamed, dropped or rewritten. Idempotent: safe to run more than
-- once. Timestamp chosen after checking the directory for a collision
-- (tests/unit/migration-version-uniqueness.test.js guards it).
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "KnowledgeEvidenceCursor" (
  "id"           TEXT PRIMARY KEY,
  "portfolioId"  TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "businessId"   TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "sharing"      TEXT NOT NULL,
  "cursor"       INTEGER NOT NULL DEFAULT 0,
  "lastPulledAt" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeEvidenceCursor_portfolioId_tenantId_businessId_workspaceId_projectId_sharing_key"
  ON "KnowledgeEvidenceCursor"("portfolioId", "tenantId", "businessId", "workspaceId", "projectId", "sharing");
CREATE INDEX IF NOT EXISTS "KnowledgeEvidenceCursor_tenantId_idx" ON "KnowledgeEvidenceCursor"("tenantId");

-- ── RLS and grants — private application table ──────────────────────────────
ALTER TABLE "KnowledgeEvidenceCursor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeEvidenceCursor" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'KnowledgeEvidenceCursor' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "KnowledgeEvidenceCursor" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "KnowledgeEvidenceCursor" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "KnowledgeEvidenceCursor" IS
  'FR-110 / ADR-068 — zuri-ai''s per-scope cursor into GKS''s gks_stage_evidence_export; advances only after the page''s ledger writes committed.';

COMMIT;
