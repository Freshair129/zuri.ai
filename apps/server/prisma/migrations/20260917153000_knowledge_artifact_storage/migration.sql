-- TASK-ZAI-049 — additive durable storage references and operation journal.
-- Raw bytes remain inline during the compatibility window; these rows add the
-- exact object/version binding needed for a later production cutover.
CREATE TABLE "KnowledgeArtifactStorage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rawArtifactId" TEXT NOT NULL,
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
    "retentionUntil" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeArtifactStorage_rawArtifactId_fkey" FOREIGN KEY ("rawArtifactId") REFERENCES "KnowledgeRawArtifact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "KnowledgeArtifactOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storageId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT,
    "reason" TEXT,
    "evidenceHash" TEXT,
    "errorCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeArtifactOperation_storageId_fkey" FOREIGN KEY ("storageId") REFERENCES "KnowledgeArtifactStorage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeArtifactStorage_rawArtifactId_key" ON "KnowledgeArtifactStorage"("rawArtifactId");
CREATE INDEX "KnowledgeArtifactStorage_tenantId_businessId_status_idx" ON "KnowledgeArtifactStorage"("tenantId", "businessId", "status");
CREATE INDEX "KnowledgeArtifactStorage_retentionUntil_status_idx" ON "KnowledgeArtifactStorage"("retentionUntil", "status");
CREATE UNIQUE INDEX "KnowledgeArtifactOperation_idempotencyKey_key" ON "KnowledgeArtifactOperation"("idempotencyKey");
CREATE INDEX "KnowledgeArtifactOperation_storageId_createdAt_idx" ON "KnowledgeArtifactOperation"("storageId", "createdAt");
CREATE INDEX "KnowledgeArtifactOperation_tenantId_businessId_operation_status_idx" ON "KnowledgeArtifactOperation"("tenantId", "businessId", "operation", "status");
