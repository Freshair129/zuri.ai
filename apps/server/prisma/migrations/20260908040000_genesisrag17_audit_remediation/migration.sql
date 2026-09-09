-- @req FR-109 — additive GenesisRAG17 source intent and durable occurrence
-- persistence for the approved audit remediation.
-- @spec ADR-071, docs/plans/GENESISRAG17-CONTRACT.md

-- A source intent is written before local Stage 1 and retains the exact input
-- and derivation configuration required for process-owned recovery.
CREATE TABLE "GenesisRag17IngestionIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intentKey" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "derivationJson" TEXT NOT NULL,
    "rawArtifactId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "nextStageNumber" INTEGER NOT NULL DEFAULT 1,
    "lastErrorJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "GenesisRag17IngestionIntent_intentKey_key"
ON "GenesisRag17IngestionIntent"("intentKey");
CREATE UNIQUE INDEX "GenesisRag17IngestionIntent_executionRunId_key"
ON "GenesisRag17IngestionIntent"("executionRunId");
CREATE INDEX "GenesisRag17IngestionIntent_tenantId_status_idx"
ON "GenesisRag17IngestionIntent"("tenantId", "status");
CREATE INDEX "GenesisRag17IngestionIntent_executionRunId_status_idx"
ON "GenesisRag17IngestionIntent"("executionRunId", "status");

-- A mention is one exact Stage 8 occurrence. Attempt identity allows a true
-- FR-071 replay to retain its own durable evidence without overwriting history.
CREATE TABLE "GenesisRag17SourceMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceMentionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "rawArtifactId" TEXT NOT NULL,
    "parsedArtifactId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "resolutionKey" TEXT NOT NULL,
    "semanticType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "recognizerVersion" TEXT NOT NULL,
    "recognizerProvenance" TEXT NOT NULL,
    "derivationHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "GenesisRag17SourceMention_executionRunId_attemptId_sourceMentionId_key"
ON "GenesisRag17SourceMention"("executionRunId", "attemptId", "sourceMentionId");
CREATE INDEX "GenesisRag17SourceMention_tenantId_parsedArtifactId_idx"
ON "GenesisRag17SourceMention"("tenantId", "parsedArtifactId");
CREATE INDEX "GenesisRag17SourceMention_executionRunId_attemptId_idx"
ON "GenesisRag17SourceMention"("executionRunId", "attemptId");
