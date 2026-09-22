-- @req FR-069, FR-070 — PM-owned execution trace and append-only replay.
-- @spec ADR-102, ADR-029, SDD-041, SEC-003, SEC-008
-- Additive SQLite twin of the provider migration. Business/scope references
-- remain scalar here so trace storage cannot introduce a second work graph.

CREATE TABLE "ProjectExecutionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionRunId" TEXT NOT NULL,
    "executionContractId" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "tenantId" TEXT,
    "businessId" TEXT,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "projectIdsJson" TEXT NOT NULL DEFAULT '[]',
    "planId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL,
    "inputSnapshotJson" TEXT NOT NULL,
    "snapshotState" TEXT NOT NULL DEFAULT 'RETAINED',
    "tagIdsJson" TEXT NOT NULL DEFAULT '[]',
    "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
    "failureCode" TEXT,
    "errorRef" TEXT,
    "retryable" BOOLEAN,
    "auditEventId" TEXT,
    "replayOfExecutionRunId" TEXT,
    "replayOfExecutionStepId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ProjectExecutionRun_executionRunId_key" ON "ProjectExecutionRun"("executionRunId");
CREATE UNIQUE INDEX "ProjectExecutionRun_business_idempotency_key" ON "ProjectExecutionRun"("businessId", "idempotencyKey");
CREATE INDEX "ProjectExecutionRun_tenantId_businessId_status_createdAt_idx" ON "ProjectExecutionRun"("tenantId", "businessId", "status", "createdAt");
CREATE INDEX "ProjectExecutionRun_projectId_createdAt_idx" ON "ProjectExecutionRun"("projectId", "createdAt");
CREATE INDEX "ProjectExecutionRun_correlationId_idx" ON "ProjectExecutionRun"("correlationId");
CREATE INDEX "ProjectExecutionRun_replayOfExecutionRunId_idx" ON "ProjectExecutionRun"("replayOfExecutionRunId");

CREATE TABLE "ProjectExecutionStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "executionStepId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionContractId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "attemptId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "tenantId" TEXT,
    "businessId" TEXT,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "planId" TEXT,
    "containerId" TEXT,
    "workItemId" TEXT,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "tagIdsJson" TEXT NOT NULL DEFAULT '[]',
    "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
    "failureCode" TEXT,
    "errorRef" TEXT,
    "retryable" BOOLEAN,
    "skippedReason" TEXT,
    "auditEventId" TEXT,
    "replayOfExecutionStepId" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectExecutionStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProjectExecutionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectExecutionStep_executionStepId_key" ON "ProjectExecutionStep"("executionStepId");
CREATE UNIQUE INDEX "ProjectExecutionStep_attemptId_key" ON "ProjectExecutionStep"("attemptId");
CREATE INDEX "ProjectExecutionStep_runId_sequence_idx" ON "ProjectExecutionStep"("runId", "sequence");
CREATE INDEX "ProjectExecutionStep_runId_status_idx" ON "ProjectExecutionStep"("runId", "status");
CREATE INDEX "ProjectExecutionStep_tenantId_businessId_projectId_status_idx" ON "ProjectExecutionStep"("tenantId", "businessId", "projectId", "status");
CREATE INDEX "ProjectExecutionStep_replayOfExecutionStepId_idx" ON "ProjectExecutionStep"("replayOfExecutionStepId");
