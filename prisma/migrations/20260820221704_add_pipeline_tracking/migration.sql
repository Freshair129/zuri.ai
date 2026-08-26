-- FR-071 / ADR-030: append-only execution evidence around the SmartGift
-- DuckDB/source-artifact -> Supabase pipeline. This is separate from
-- IngestionRun (transport staging) and PlanImportReceipt (plan import).
CREATE TABLE "PipelineRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "executionRunId" TEXT NOT NULL,
  "dataPipelineDefinitionId" TEXT NOT NULL,
  "executionContractId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "currentStageId" TEXT,
  "sourceRef" TEXT,
  "sourceSha256" TEXT,
  "artifactRef" TEXT,
  "artifactSha256" TEXT,
  "bootstrapBatchId" TEXT,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "expectedCount" INTEGER NOT NULL DEFAULT 0,
  "actualCount" INTEGER NOT NULL DEFAULT 0,
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "tagIdsJson" TEXT NOT NULL DEFAULT '[]',
  "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
  "primaryFailureCode" TEXT,
  "primaryErrorRef" TEXT,
  "primaryRetryable" BOOLEAN,
  "auditEventId" TEXT,
  "replayScope" TEXT,
  "replayOfExecutionRunId" TEXT,
  "replayOfExecutionStepId" TEXT,
  "replayOfPipelineRecordId" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "lastHeartbeatAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PipelineRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PipelineRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PipelineRun_executionRunId_key" ON "PipelineRun"("executionRunId");
CREATE UNIQUE INDEX "PipelineRun_idempotencyKey_key" ON "PipelineRun"("idempotencyKey");
CREATE INDEX "PipelineRun_tenantId_status_idx" ON "PipelineRun"("tenantId", "status");
CREATE INDEX "PipelineRun_businessId_status_createdAt_idx" ON "PipelineRun"("businessId", "status", "createdAt");
CREATE INDEX "PipelineRun_correlationId_idx" ON "PipelineRun"("correlationId");
CREATE INDEX "PipelineRun_replayOfExecutionRunId_idx" ON "PipelineRun"("replayOfExecutionRunId");

CREATE TABLE "PipelineStep" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "executionStepId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "pipelineStageId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "attemptId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "inputHash" TEXT,
  "outputHash" TEXT,
  "expectedCount" INTEGER NOT NULL DEFAULT 0,
  "actualCount" INTEGER NOT NULL DEFAULT 0,
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT,
  "errorRef" TEXT,
  "retryable" BOOLEAN,
  "tagIdsJson" TEXT NOT NULL DEFAULT '[]',
  "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
  "auditEventId" TEXT,
  "replayOfExecutionStepId" TEXT,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  "lastHeartbeatAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PipelineStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PipelineStep_executionStepId_key" ON "PipelineStep"("executionStepId");
CREATE UNIQUE INDEX "PipelineStep_attemptId_key" ON "PipelineStep"("attemptId");
CREATE INDEX "PipelineStep_runId_pipelineStageId_sequence_idx" ON "PipelineStep"("runId", "pipelineStageId", "sequence");
CREATE INDEX "PipelineStep_runId_status_idx" ON "PipelineStep"("runId", "status");

CREATE TABLE "PipelineEventReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventHash" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL DEFAULT '{}',
  "auditEventId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PipelineEventReceipt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PipelineEventReceipt_idempotencyKey_key" ON "PipelineEventReceipt"("idempotencyKey");
CREATE INDEX "PipelineEventReceipt_runId_eventType_idx" ON "PipelineEventReceipt"("runId", "eventType");

CREATE TABLE "PipelineRecordEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "stepId" TEXT,
  "attemptId" TEXT NOT NULL,
  "pipelineRecordId" TEXT NOT NULL,
  "sourceRecordKey" TEXT,
  "sourceRowNumber" INTEGER,
  "sourceSha256" TEXT,
  "docId" TEXT,
  "picId" TEXT,
  "factId" TEXT,
  "sourceDocIdsJson" TEXT NOT NULL DEFAULT '[]',
  "sourcePicIdsJson" TEXT NOT NULL DEFAULT '[]',
  "destinationRecordId" TEXT,
  "status" TEXT NOT NULL,
  "failureCode" TEXT,
  "errorRef" TEXT,
  "retryable" BOOLEAN,
  "tagIdsJson" TEXT NOT NULL DEFAULT '[]',
  "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
  "idempotencyKey" TEXT NOT NULL,
  "auditEventId" TEXT,
  "replayOfPipelineRecordId" TEXT,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PipelineRecordEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PipelineRecordEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PipelineRecordEvent_idempotencyKey_key" ON "PipelineRecordEvent"("idempotencyKey");
CREATE INDEX "PipelineRecordEvent_runId_status_idx" ON "PipelineRecordEvent"("runId", "status");
CREATE INDEX "PipelineRecordEvent_pipelineRecordId_idx" ON "PipelineRecordEvent"("pipelineRecordId");
CREATE INDEX "PipelineRecordEvent_docId_idx" ON "PipelineRecordEvent"("docId");
CREATE INDEX "PipelineRecordEvent_picId_idx" ON "PipelineRecordEvent"("picId");
CREATE INDEX "PipelineRecordEvent_factId_idx" ON "PipelineRecordEvent"("factId");

CREATE TABLE "PipelineReconciliation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "stepId" TEXT,
  "expectedCount" INTEGER NOT NULL DEFAULT 0,
  "actualCount" INTEGER NOT NULL DEFAULT 0,
  "insertedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "sourceSha256" TEXT,
  "artifactSha256" TEXT,
  "stagingHash" TEXT,
  "destinationHash" TEXT,
  "rlsProbeResult" TEXT,
  "isolationResult" TEXT,
  "result" TEXT NOT NULL,
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "auditEventId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PipelineReconciliation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PipelineReconciliation_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineStep" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PipelineReconciliation_runId_result_idx" ON "PipelineReconciliation"("runId", "result");
CREATE INDEX "PipelineReconciliation_stepId_idx" ON "PipelineReconciliation"("stepId");

CREATE TABLE "PipelineGateDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "gateId" TEXT,
  "status" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT 1,
  "decidedByPersonId" TEXT,
  "reason" TEXT,
  "evidenceJson" TEXT NOT NULL DEFAULT '{}',
  "auditEventId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PipelineGateDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PipelineGateDecision_runId_status_idx" ON "PipelineGateDecision"("runId", "status");
CREATE INDEX "PipelineGateDecision_gateId_idx" ON "PipelineGateDecision"("gateId");
