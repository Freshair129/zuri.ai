-- @req FR-109, FR-173 — durable raw artifact object references and the
-- operation journal are private application tables with forced RLS.
-- @spec TASK-ZAI-049 storage spec, ADR-072
-- @tested tests/unit/knowledge-artifact-storage-schema.test.js
-- Additive only. This migration is not production-applied by this change.
BEGIN;

CREATE TABLE IF NOT EXISTS "KnowledgeArtifactStorage" (
  "id" TEXT PRIMARY KEY,
  "rawArtifactId" TEXT NOT NULL UNIQUE REFERENCES "KnowledgeRawArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "portfolioId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "bindingId" TEXT NOT NULL,
  "bindingRevision" INTEGER NOT NULL,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "objectVersionId" TEXT,
  "sha256" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "contentType" TEXT NOT NULL,
  "policyJson" TEXT NOT NULL,
  "retentionUntil" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "KnowledgeArtifactOperation" (
  "id" TEXT PRIMARY KEY,
  "storageId" TEXT NOT NULL REFERENCES "KnowledgeArtifactStorage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "portfolioId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "visibility" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL UNIQUE,
  "operation" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "actorId" TEXT,
  "reason" TEXT,
  "evidenceHash" TEXT,
  "errorCode" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "KnowledgeArtifactStorage_tenantId_businessId_status_idx" ON "KnowledgeArtifactStorage"("tenantId", "businessId", "status");
CREATE INDEX IF NOT EXISTS "KnowledgeArtifactStorage_retentionUntil_status_idx" ON "KnowledgeArtifactStorage"("retentionUntil", "status");
CREATE INDEX IF NOT EXISTS "KnowledgeArtifactOperation_storageId_createdAt_idx" ON "KnowledgeArtifactOperation"("storageId", "createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeArtifactOperation_tenantId_businessId_operation_status_idx" ON "KnowledgeArtifactOperation"("tenantId", "businessId", "operation", "status");

ALTER TABLE "KnowledgeArtifactStorage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeArtifactStorage" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'KnowledgeArtifactStorage' AND policyname = 'zuri_app_runtime_all') THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "KnowledgeArtifactStorage" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;
REVOKE ALL ON TABLE "KnowledgeArtifactStorage" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "KnowledgeArtifactStorage" TO zuri_app_runtime, zuri_web_login;

ALTER TABLE "KnowledgeArtifactOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeArtifactOperation" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'KnowledgeArtifactOperation' AND policyname = 'zuri_app_runtime_all') THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "KnowledgeArtifactOperation" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;
REVOKE ALL ON TABLE "KnowledgeArtifactOperation" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "KnowledgeArtifactOperation" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "KnowledgeArtifactStorage" IS 'TASK-ZAI-049 — exact raw artifact object/version references; inline payload remains during compatibility migration.';
COMMENT ON TABLE "KnowledgeArtifactOperation" IS 'TASK-ZAI-049 — idempotent storage, recovery and erasure operation journal.';

COMMIT;
