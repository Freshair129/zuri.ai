-- @req FR-236 — KnowledgeCandidate: a LINE FAQ knowledge candidate (knowledge
-- domain, ADR-090 D6). A canonical question/answer drafted from one
-- consent-GRANTED Conversation, decided (APPROVE/REJECT, audited) by a
-- Business OWNER or LINE_OA_PUBLISHER, and admitted through the existing
-- ADR-072 admission service as one immutable LINE_FAQ_CANDIDATE TEXT source
-- on APPROVE only. `conversationId` + `sourceRefJson` are the only fields
-- naming a source conversation (FR-232 erasure fan-out walks exactly these
-- two); neither ever carries a LINE user id or externalThreadId.
-- @spec ADR-090 D6, D8; ADR-072; SEC-032; BR-002; SEC-001
-- @tested tests/unit/knowledge-candidate-migration.test.js, tests/integration/fr236-knowledge-candidate.test.js
--
-- Additive only: one new table, its indexes, foreign keys, forced RLS and the
-- same private-application-table grant shape every table in this schema
-- carries (20260906230000_inventory_domain.sql is the pattern this and
-- 20260906235500_crm_sales_task.sql both follow). Nothing existing is
-- altered, renamed, dropped or rewritten. Idempotent: safe to run more than
-- once. Timestamp chosen after checking the directory for a collision
-- (tests/unit/migration-version-uniqueness.test.js guards it).
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "KnowledgeCandidate" (
  "id"                   TEXT PRIMARY KEY,
  "tenantId"             TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"           TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "conversationId"       TEXT REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "sourceRefJson"        TEXT NOT NULL,
  "status"               TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "question"             TEXT NOT NULL,
  "answer"               TEXT NOT NULL,
  "contentHash"          TEXT NOT NULL,
  "consentStatusAtDraft" TEXT NOT NULL,
  "idempotencyKey"       TEXT NOT NULL,
  "requestHash"          TEXT NOT NULL,
  "createdByPersonId"    TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "decidedByPersonId"    TEXT,
  "decidedAt"            TIMESTAMP(3),
  "decisionReason"       TEXT,
  "admittedSourceId"     TEXT,
  "admittedIngestionId"  TEXT,
  "tombstonedAt"         TIMESTAMP(3),
  "version"              INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeCandidate_businessId_idempotencyKey_key" ON "KnowledgeCandidate"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "KnowledgeCandidate_businessId_status_idx" ON "KnowledgeCandidate"("businessId", "status");
CREATE INDEX IF NOT EXISTS "KnowledgeCandidate_conversationId_idx" ON "KnowledgeCandidate"("conversationId");

-- ── RLS and grants — private application table ──────────────────────────────
ALTER TABLE "KnowledgeCandidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeCandidate" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'KnowledgeCandidate' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "KnowledgeCandidate" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "KnowledgeCandidate" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "KnowledgeCandidate" IS
  'FR-236 — a LINE FAQ knowledge candidate (knowledge, ADR-090 D6): Business-scoped, drafted from one consent-GRANTED Conversation, decided (audited) by OWNER or LINE_OA_PUBLISHER; PENDING_REVIEW -> APPROVED | REJECTED, or TOMBSTONED by FR-232 erasure. APPROVED admits one immutable LINE_FAQ_CANDIDATE TEXT source through the existing ADR-072 admission service.';

COMMIT;
