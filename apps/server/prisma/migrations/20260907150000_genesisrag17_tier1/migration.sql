-- @req FR-109 / FR-110 — additive GenesisRAG17 Tier 1 TEST lineage,
-- receipt and exact-attempt evidence.
-- @spec ADR-050, ADR-068, docs/plans/GENESISRAG17-CONTRACT.md

-- CreateTable
CREATE TABLE "KnowledgeRawArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawExternalRecordId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUri" TEXT,
    "contentType" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeRawArtifact_rawExternalRecordId_fkey" FOREIGN KEY ("rawExternalRecordId") REFERENCES "RawExternalRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRawArtifact_rawExternalRecordId_key" ON "KnowledgeRawArtifact"("rawExternalRecordId");
CREATE UNIQUE INDEX "KnowledgeRawArtifact_portfolioId_tenantId_businessId_workspaceId_agentId_visibility_sourceId_version_contentHash_pipelineVersion_key"
ON "KnowledgeRawArtifact"("portfolioId", "tenantId", "businessId", "workspaceId", "agentId", "visibility", "sourceId", "version", "contentHash", "pipelineVersion");
CREATE INDEX "KnowledgeRawArtifact_tenantId_documentId_version_idx"
ON "KnowledgeRawArtifact"("tenantId", "documentId", "version");
CREATE INDEX "KnowledgeRawArtifact_tenantId_contentHash_idx"
ON "KnowledgeRawArtifact"("tenantId", "contentHash");

-- CreateTable
CREATE TABLE "KnowledgeParsedArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawArtifactId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "structureJson" TEXT NOT NULL DEFAULT '[]',
    "textBlocksJson" TEXT NOT NULL DEFAULT '[]',
    "tablesJson" TEXT NOT NULL DEFAULT '[]',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeParsedArtifact_rawArtifactId_fkey" FOREIGN KEY ("rawArtifactId") REFERENCES "KnowledgeRawArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeParsedArtifact_rawArtifactId_parserVersion_key"
ON "KnowledgeParsedArtifact"("rawArtifactId", "parserVersion");
CREATE INDEX "KnowledgeParsedArtifact_tenantId_documentId_idx"
ON "KnowledgeParsedArtifact"("tenantId", "documentId");
CREATE INDEX "KnowledgeParsedArtifact_rawArtifactId_idx"
ON "KnowledgeParsedArtifact"("rawArtifactId");

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parsedArtifactId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "headingPathJson" TEXT NOT NULL DEFAULT '[]',
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_parsedArtifactId_fkey" FOREIGN KEY ("parsedArtifactId") REFERENCES "KnowledgeParsedArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_parsedArtifactId_ordinal_key"
ON "KnowledgeChunk"("parsedArtifactId", "ordinal");
CREATE INDEX "KnowledgeChunk_tenantId_documentId_ordinal_idx"
ON "KnowledgeChunk"("tenantId", "documentId", "ordinal");
CREATE INDEX "KnowledgeChunk_parsedArtifactId_idx"
ON "KnowledgeChunk"("parsedArtifactId");

-- CreateTable
CREATE TABLE "GenesisRag17Batch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "stage9StepId" TEXT NOT NULL,
    "stage9AttemptId" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionId" TEXT,
    "responseJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17Batch_batchId_key" ON "GenesisRag17Batch"("batchId");
CREATE UNIQUE INDEX "GenesisRag17Batch_idempotencyKey_key" ON "GenesisRag17Batch"("idempotencyKey");
CREATE UNIQUE INDEX "GenesisRag17Batch_executionRunId_stage9AttemptId_key"
ON "GenesisRag17Batch"("executionRunId", "stage9AttemptId");
CREATE INDEX "GenesisRag17Batch_runId_status_idx" ON "GenesisRag17Batch"("runId", "status");

-- CreateTable
CREATE TABLE "GenesisRag17StageEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cursor" INTEGER,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "pipelineStageId" TEXT NOT NULL,
    "executionStepId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "stageNumber" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME NOT NULL,
    "recordsIn" INTEGER NOT NULL,
    "recordsOut" INTEGER NOT NULL,
    "recordsQuarantined" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL,
    "durationMs" REAL NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "rowHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17StageEvidence_executionRunId_pipelineStageId_executionStepId_attemptId_key"
ON "GenesisRag17StageEvidence"("executionRunId", "pipelineStageId", "executionStepId", "attemptId");
CREATE INDEX "GenesisRag17StageEvidence_runId_stageNumber_idx"
ON "GenesisRag17StageEvidence"("runId", "stageNumber");
CREATE INDEX "GenesisRag17StageEvidence_executionRunId_cursor_idx"
ON "GenesisRag17StageEvidence"("executionRunId", "cursor");

-- CreateTable
CREATE TABLE "GenesisRag17PublicationReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "decisionHash" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "pointerHash" TEXT NOT NULL,
    "modelRevision" TEXT NOT NULL,
    "transactionFrontier" TEXT NOT NULL,
    "readbackJson" TEXT NOT NULL,
    "receiptJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17PublicationReceipt_executionRunId_decisionId_decisionHash_snapshotId_generation_receiptHash_key"
ON "GenesisRag17PublicationReceipt"("executionRunId", "decisionId", "decisionHash", "snapshotId", "generation", "receiptHash");
CREATE INDEX "GenesisRag17PublicationReceipt_runId_snapshotId_generation_idx"
ON "GenesisRag17PublicationReceipt"("runId", "snapshotId", "generation");

-- CreateTable
CREATE TABLE "GenesisRag17EvidenceCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "lastPulledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17EvidenceCursor_runId_portfolioId_tenantId_businessId_workspaceId_agentId_visibility_key"
ON "GenesisRag17EvidenceCursor"("runId", "portfolioId", "tenantId", "businessId", "workspaceId", "agentId", "visibility");
CREATE INDEX "GenesisRag17EvidenceCursor_tenantId_idx" ON "GenesisRag17EvidenceCursor"("tenantId");
