-- @req FR-109 — additive GenesisRAG17 source intent and durable occurrence
-- persistence for the approved audit remediation.
-- @spec ADR-070, docs/plans/GENESISRAG17-CONTRACT.md
-- @tested tests/unit/genesisrag17-supabase-migration.test.js
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step after a rolled-back dry run and recorded schema receipt.

BEGIN;

CREATE TABLE IF NOT EXISTS "GenesisRag17IngestionIntent" (
  "id"              TEXT NOT NULL,
  "intentKey"       TEXT NOT NULL,
  "runId"           TEXT NOT NULL,
  "executionRunId"  TEXT NOT NULL,
  "scopeJson"       TEXT NOT NULL,
  "requestJson"     TEXT NOT NULL,
  "derivationJson"  TEXT NOT NULL,
  "rawArtifactId"   TEXT NOT NULL,
  "sourceId"        TEXT NOT NULL,
  "documentId"      TEXT NOT NULL,
  "version"         TEXT NOT NULL,
  "contentHash"     TEXT NOT NULL,
  "portfolioId"     TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "businessId"      TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "agentId"         TEXT NOT NULL,
  "visibility"      TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "nextStageNumber" INTEGER NOT NULL DEFAULT 1,
  "lastErrorJson"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenesisRag17IngestionIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GenesisRag17SourceMention" (
  "id"                   TEXT NOT NULL,
  "sourceMentionId"      TEXT NOT NULL,
  "runId"                TEXT NOT NULL,
  "executionRunId"       TEXT NOT NULL,
  "attemptId"            TEXT NOT NULL,
  "sourceId"             TEXT NOT NULL,
  "documentId"           TEXT NOT NULL,
  "version"              TEXT NOT NULL,
  "rawArtifactId"        TEXT NOT NULL,
  "parsedArtifactId"     TEXT NOT NULL,
  "chunkId"              TEXT NOT NULL,
  "resolutionKey"        TEXT NOT NULL,
  "semanticType"         TEXT NOT NULL,
  "name"                 TEXT NOT NULL,
  "startOffset"          INTEGER NOT NULL,
  "endOffset"            INTEGER NOT NULL,
  "recognizerVersion"    TEXT NOT NULL,
  "recognizerProvenance" TEXT NOT NULL,
  "derivationHash"       TEXT NOT NULL,
  "contentHash"          TEXT NOT NULL,
  "portfolioId"          TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL,
  "businessId"           TEXT NOT NULL,
  "workspaceId"          TEXT NOT NULL,
  "agentId"              TEXT NOT NULL,
  "visibility"           TEXT NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenesisRag17SourceMention_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17IngestionIntent_intentKey_key"
  ON "GenesisRag17IngestionIntent"("intentKey");
CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17IngestionIntent_executionRunId_key"
  ON "GenesisRag17IngestionIntent"("executionRunId");
CREATE INDEX IF NOT EXISTS "GenesisRag17IngestionIntent_tenantId_status_idx"
  ON "GenesisRag17IngestionIntent"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "GenesisRag17IngestionIntent_executionRunId_status_idx"
  ON "GenesisRag17IngestionIntent"("executionRunId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17SourceMention_executionRunId_attemptId_sourceMentionId_key"
  ON "GenesisRag17SourceMention"("executionRunId", "attemptId", "sourceMentionId");
CREATE INDEX IF NOT EXISTS "GenesisRag17SourceMention_tenantId_parsedArtifactId_idx"
  ON "GenesisRag17SourceMention"("tenantId", "parsedArtifactId");
CREATE INDEX IF NOT EXISTS "GenesisRag17SourceMention_executionRunId_attemptId_idx"
  ON "GenesisRag17SourceMention"("executionRunId", "attemptId");

ALTER TABLE "GenesisRag17IngestionIntent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17IngestionIntent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17SourceMention" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17SourceMention" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'GenesisRag17IngestionIntent' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "GenesisRag17IngestionIntent" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'GenesisRag17SourceMention' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "GenesisRag17SourceMention" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "GenesisRag17IngestionIntent" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "GenesisRag17SourceMention" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "GenesisRag17IngestionIntent" IS
  'FR-109 — exact scoped source input and derivation intent for pre-Stage-9 recovery.';
COMMENT ON TABLE "GenesisRag17SourceMention" IS
  'FR-109 — durable typed Stage 8 occurrence bound to source attempt and recognizer provenance.';

COMMIT;
