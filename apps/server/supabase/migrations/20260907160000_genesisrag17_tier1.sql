-- @req FR-109, FR-110 — additive GenesisRAG17 TEST persistence for the
-- source/parsed/chunk lineage, Stage 9 retry ledger, six-lane evidence and
-- publication receipts. This is the Postgres counterpart of
-- prisma/migrations/20260907150000_genesisrag17_tier1/migration.sql.
-- @spec ADR-050, ADR-063, ADR-068, docs/plans/GENESISRAG17-CONTRACT.md
-- @tested tests/unit/genesisrag17-supabase-migration.test.js;
--         tests/unit/schema-migration-drift.test.js
--
-- The table/index statements below are the offline Prisma schema diff from
-- the previous HEAD version of prisma/schema.postgres.prisma to the current
-- schema. The index names ending in `_key` / `_idx` are the exact 63-byte
-- names emitted by Prisma's PostgreSQL diff for long composite names.
--
-- Additive and idempotent: tables and indexes use IF NOT EXISTS, while the
-- foreign keys are guarded by constraint name. Nothing existing is altered,
-- renamed, dropped or rewritten. Every table is private application data:
-- forced RLS is enabled, access is limited to the existing runtime roles, and
-- Supabase Data API roles plus service_role receive no table privileges.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057): dry run in a rolled-back transaction, then apply
-- and record the version.

BEGIN;

-- ── immutable Tier 1 source lineage ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "KnowledgeRawArtifact" (
  "id"                  TEXT NOT NULL,
  "rawExternalRecordId" TEXT NOT NULL,
  "sourceId"            TEXT NOT NULL,
  "documentId"          TEXT NOT NULL,
  "version"             TEXT NOT NULL,
  "contentHash"         TEXT NOT NULL,
  "content"             TEXT NOT NULL,
  "sourceType"          TEXT NOT NULL,
  "sourceUri"           TEXT,
  "contentType"         TEXT NOT NULL,
  "pipelineVersion"     TEXT NOT NULL,
  "schemaVersion"       TEXT NOT NULL,
  "portfolioId"         TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "businessId"          TEXT NOT NULL,
  "workspaceId"         TEXT NOT NULL,
  "agentId"             TEXT NOT NULL,
  "visibility"          TEXT NOT NULL,
  "receivedAt"          TIMESTAMP(3) NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeRawArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "KnowledgeParsedArtifact" (
  "id"             TEXT NOT NULL,
  "rawArtifactId"  TEXT NOT NULL,
  "documentId"     TEXT NOT NULL,
  "parserVersion"  TEXT NOT NULL,
  "contentHash"    TEXT NOT NULL,
  "content"        TEXT NOT NULL,
  "structureJson"  TEXT NOT NULL DEFAULT '[]',
  "textBlocksJson" TEXT NOT NULL DEFAULT '[]',
  "tablesJson"     TEXT NOT NULL DEFAULT '[]',
  "metadataJson"   TEXT NOT NULL DEFAULT '{}',
  "portfolioId"    TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "businessId"     TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "agentId"        TEXT NOT NULL,
  "visibility"     TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeParsedArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
  "id"               TEXT NOT NULL,
  "parsedArtifactId" TEXT NOT NULL,
  "documentId"       TEXT NOT NULL,
  "ordinal"          INTEGER NOT NULL,
  "text"             TEXT NOT NULL,
  "contentHash"      TEXT NOT NULL,
  "startOffset"      INTEGER NOT NULL,
  "endOffset"        INTEGER NOT NULL,
  "headingPathJson"  TEXT NOT NULL DEFAULT '[]',
  "tokenCount"       INTEGER NOT NULL DEFAULT 0,
  "portfolioId"      TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "businessId"       TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "agentId"          TEXT NOT NULL,
  "visibility"       TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- ── durable Stage 9–17 evidence ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GenesisRag17Batch" (
  "id"              TEXT NOT NULL,
  "batchId"         TEXT NOT NULL,
  "idempotencyKey"  TEXT NOT NULL,
  "runId"           TEXT NOT NULL,
  "executionRunId"  TEXT NOT NULL,
  "stage9StepId"    TEXT NOT NULL,
  "stage9AttemptId" TEXT NOT NULL,
  "scopeJson"       TEXT NOT NULL,
  "requestJson"     TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "decisionId"      TEXT,
  "responseJson"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenesisRag17Batch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GenesisRag17StageEvidence" (
  "id"                 TEXT NOT NULL,
  "cursor"             INTEGER,
  "runId"              TEXT NOT NULL,
  "executionRunId"     TEXT NOT NULL,
  "pipelineStageId"    TEXT NOT NULL,
  "executionStepId"    TEXT NOT NULL,
  "attemptId"          TEXT NOT NULL,
  "stageNumber"        INTEGER NOT NULL,
  "outcome"            TEXT NOT NULL,
  "startedAt"          TIMESTAMP(3) NOT NULL,
  "finishedAt"         TIMESTAMP(3) NOT NULL,
  "recordsIn"          INTEGER NOT NULL,
  "recordsOut"         INTEGER NOT NULL,
  "recordsQuarantined" INTEGER NOT NULL,
  "errorCount"         INTEGER NOT NULL,
  "retryCount"         INTEGER NOT NULL,
  "durationMs"         DOUBLE PRECISION NOT NULL,
  "detailsJson"        TEXT NOT NULL DEFAULT '{}',
  "rowHash"            TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenesisRag17StageEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GenesisRag17PublicationReceipt" (
  "id"                  TEXT NOT NULL,
  "runId"               TEXT NOT NULL,
  "executionRunId"      TEXT NOT NULL,
  "scopeJson"           TEXT NOT NULL,
  "decisionId"          TEXT NOT NULL,
  "decisionHash"        TEXT NOT NULL,
  "snapshotId"          TEXT NOT NULL,
  "generation"          TEXT NOT NULL,
  "receiptHash"         TEXT NOT NULL,
  "publishedAt"         TIMESTAMP(3) NOT NULL,
  "pointerHash"         TEXT NOT NULL,
  "modelRevision"       TEXT NOT NULL,
  "transactionFrontier" TEXT NOT NULL,
  "readbackJson"        TEXT NOT NULL,
  "receiptJson"         TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenesisRag17PublicationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GenesisRag17EvidenceCursor" (
  "id"           TEXT NOT NULL,
  "runId"        TEXT NOT NULL,
  "portfolioId"  TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "businessId"   TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "agentId"      TEXT NOT NULL,
  "visibility"   TEXT NOT NULL,
  "cursor"       INTEGER NOT NULL DEFAULT 0,
  "lastPulledAt" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenesisRag17EvidenceCursor_pkey" PRIMARY KEY ("id")
);

-- ── indexes — names from the offline Postgres schema diff ──────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeRawArtifact_rawExternalRecordId_key"
  ON "KnowledgeRawArtifact"("rawExternalRecordId");
CREATE INDEX IF NOT EXISTS "KnowledgeRawArtifact_tenantId_documentId_version_idx"
  ON "KnowledgeRawArtifact"("tenantId", "documentId", "version");
CREATE INDEX IF NOT EXISTS "KnowledgeRawArtifact_tenantId_contentHash_idx"
  ON "KnowledgeRawArtifact"("tenantId", "contentHash");
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeRawArtifact_portfolioId_tenantId_businessId_worksp_key"
  ON "KnowledgeRawArtifact"("portfolioId", "tenantId", "businessId", "workspaceId", "agentId", "visibility", "sourceId", "version", "contentHash", "pipelineVersion");

CREATE INDEX IF NOT EXISTS "KnowledgeParsedArtifact_tenantId_documentId_idx"
  ON "KnowledgeParsedArtifact"("tenantId", "documentId");
CREATE INDEX IF NOT EXISTS "KnowledgeParsedArtifact_rawArtifactId_idx"
  ON "KnowledgeParsedArtifact"("rawArtifactId");
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeParsedArtifact_rawArtifactId_parserVersion_key"
  ON "KnowledgeParsedArtifact"("rawArtifactId", "parserVersion");

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_tenantId_documentId_ordinal_idx"
  ON "KnowledgeChunk"("tenantId", "documentId", "ordinal");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_parsedArtifactId_idx"
  ON "KnowledgeChunk"("parsedArtifactId");
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeChunk_parsedArtifactId_ordinal_key"
  ON "KnowledgeChunk"("parsedArtifactId", "ordinal");

CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17Batch_batchId_key"
  ON "GenesisRag17Batch"("batchId");
CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17Batch_idempotencyKey_key"
  ON "GenesisRag17Batch"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "GenesisRag17Batch_runId_status_idx"
  ON "GenesisRag17Batch"("runId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17Batch_executionRunId_stage9AttemptId_key"
  ON "GenesisRag17Batch"("executionRunId", "stage9AttemptId");

CREATE INDEX IF NOT EXISTS "GenesisRag17StageEvidence_runId_stageNumber_idx"
  ON "GenesisRag17StageEvidence"("runId", "stageNumber");
CREATE INDEX IF NOT EXISTS "GenesisRag17StageEvidence_executionRunId_cursor_idx"
  ON "GenesisRag17StageEvidence"("executionRunId", "cursor");
CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17StageEvidence_executionRunId_pipelineStageId_ex_key"
  ON "GenesisRag17StageEvidence"("executionRunId", "pipelineStageId", "executionStepId", "attemptId");

CREATE INDEX IF NOT EXISTS "GenesisRag17PublicationReceipt_runId_snapshotId_generation_idx"
  ON "GenesisRag17PublicationReceipt"("runId", "snapshotId", "generation");
CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17PublicationReceipt_executionRunId_decisionId_de_key"
  ON "GenesisRag17PublicationReceipt"("executionRunId", "decisionId", "decisionHash", "snapshotId", "generation", "receiptHash");

CREATE INDEX IF NOT EXISTS "GenesisRag17EvidenceCursor_tenantId_idx"
  ON "GenesisRag17EvidenceCursor"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "GenesisRag17EvidenceCursor_runId_portfolioId_tenantId_busin_key"
  ON "GenesisRag17EvidenceCursor"("runId", "portfolioId", "tenantId", "businessId", "workspaceId", "agentId", "visibility");

-- ── foreign keys — guarded for safe re-runs ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeRawArtifact_rawExternalRecordId_fkey') THEN
    ALTER TABLE "KnowledgeRawArtifact" ADD CONSTRAINT "KnowledgeRawArtifact_rawExternalRecordId_fkey"
      FOREIGN KEY ("rawExternalRecordId") REFERENCES "RawExternalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeParsedArtifact_rawArtifactId_fkey') THEN
    ALTER TABLE "KnowledgeParsedArtifact" ADD CONSTRAINT "KnowledgeParsedArtifact_rawArtifactId_fkey"
      FOREIGN KEY ("rawArtifactId") REFERENCES "KnowledgeRawArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeChunk_parsedArtifactId_fkey') THEN
    ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_parsedArtifactId_fkey"
      FOREIGN KEY ("parsedArtifactId") REFERENCES "KnowledgeParsedArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── RLS and grants — private application tables ─────────────────────────────
ALTER TABLE "KnowledgeRawArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeRawArtifact" FORCE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeParsedArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeParsedArtifact" FORCE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeChunk" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17Batch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17Batch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17StageEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17StageEvidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17PublicationReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17PublicationReceipt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17EvidenceCursor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GenesisRag17EvidenceCursor" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'KnowledgeRawArtifact' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "KnowledgeRawArtifact" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'KnowledgeParsedArtifact' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "KnowledgeParsedArtifact" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'KnowledgeChunk' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "KnowledgeChunk" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'GenesisRag17Batch' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "GenesisRag17Batch" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'GenesisRag17StageEvidence' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "GenesisRag17StageEvidence" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'GenesisRag17PublicationReceipt' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "GenesisRag17PublicationReceipt" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'GenesisRag17EvidenceCursor' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "GenesisRag17EvidenceCursor" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "KnowledgeRawArtifact" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "KnowledgeParsedArtifact" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "KnowledgeChunk" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "GenesisRag17Batch" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "GenesisRag17StageEvidence" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "GenesisRag17PublicationReceipt" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "GenesisRag17EvidenceCursor" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "KnowledgeRawArtifact" IS
  'FR-109 — immutable GenesisRAG17 source payload linked to RawExternalRecord.';
COMMENT ON TABLE "KnowledgeParsedArtifact" IS
  'FR-109 — immutable parsed representation of a GenesisRAG17 raw artifact.';
COMMENT ON TABLE "KnowledgeChunk" IS
  'FR-109 — exact source substring with UTF-16 offsets and durable lineage.';
COMMENT ON TABLE "GenesisRag17Batch" IS
  'FR-109 — one idempotent Stage 9 batch bound to one execution attempt.';
COMMENT ON TABLE "GenesisRag17StageEvidence" IS
  'FR-109 — durable per-stage evidence and all six frozen metrics.';
COMMENT ON TABLE "GenesisRag17PublicationReceipt" IS
  'FR-110 — durable Stage 17 publication receipt bound to decision, snapshot and generation.';
COMMENT ON TABLE "GenesisRag17EvidenceCursor" IS
  'FR-110 — durable cursor advanced only after evidence writes commit.';

COMMIT;
