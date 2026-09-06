-- @req FR-071 — private server-owned full pipeline tracking ledger around the
-- SmartGift source/artifact -> Supabase execution boundary.
-- @spec ADR-030 D2-D6, SDD-042, SEC-003, SEC-008
-- @tested tests/unit/platform/pipeline-tracking-migration.test.js

BEGIN;

CREATE TABLE IF NOT EXISTS "PipelineRun" (
  "id" text PRIMARY KEY,
  "executionRunId" text NOT NULL UNIQUE,
  "dataPipelineDefinitionId" text NOT NULL,
  "executionContractId" text NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "businessId" text REFERENCES "Business"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "currentStageId" text,
  "sourceRef" text,
  "sourceSha256" text,
  "artifactRef" text,
  "artifactSha256" text,
  "bootstrapBatchId" text,
  "correlationId" text NOT NULL,
  "idempotencyKey" text NOT NULL UNIQUE,
  "requestHash" text NOT NULL,
  "expectedCount" integer NOT NULL DEFAULT 0,
  "actualCount" integer NOT NULL DEFAULT 0,
  "insertedCount" integer NOT NULL DEFAULT 0,
  "updatedCount" integer NOT NULL DEFAULT 0,
  "unchangedCount" integer NOT NULL DEFAULT 0,
  "failedCount" integer NOT NULL DEFAULT 0,
  "rejectedCount" integer NOT NULL DEFAULT 0,
  "duplicateCount" integer NOT NULL DEFAULT 0,
  "tagIdsJson" text NOT NULL DEFAULT '[]',
  "identityRefsJson" text NOT NULL DEFAULT '{}',
  "primaryFailureCode" text,
  "primaryErrorRef" text,
  "primaryRetryable" boolean,
  "auditEventId" text,
  "replayScope" text,
  "replayOfExecutionRunId" text,
  "replayOfExecutionStepId" text,
  "replayOfPipelineRecordId" text,
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "lastHeartbeatAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PipelineRun_tenantId_status_idx" ON "PipelineRun"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "PipelineRun_businessId_status_createdAt_idx" ON "PipelineRun"("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PipelineRun_correlationId_idx" ON "PipelineRun"("correlationId");
CREATE INDEX IF NOT EXISTS "PipelineRun_replayOfExecutionRunId_idx" ON "PipelineRun"("replayOfExecutionRunId");

CREATE TABLE IF NOT EXISTS "PipelineStep" (
  "id" text PRIMARY KEY,
  "executionStepId" text NOT NULL UNIQUE,
  "runId" text NOT NULL REFERENCES "PipelineRun"("id") ON DELETE CASCADE,
  "pipelineStageId" text NOT NULL,
  "sequence" integer NOT NULL,
  "attemptId" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'NOT_STARTED',
  "inputHash" text,
  "outputHash" text,
  "expectedCount" integer NOT NULL DEFAULT 0,
  "actualCount" integer NOT NULL DEFAULT 0,
  "insertedCount" integer NOT NULL DEFAULT 0,
  "updatedCount" integer NOT NULL DEFAULT 0,
  "unchangedCount" integer NOT NULL DEFAULT 0,
  "failedCount" integer NOT NULL DEFAULT 0,
  "skippedCount" integer NOT NULL DEFAULT 0,
  "failureCode" text,
  "errorRef" text,
  "retryable" boolean,
  "tagIdsJson" text NOT NULL DEFAULT '[]',
  "identityRefsJson" text NOT NULL DEFAULT '{}',
  "auditEventId" text,
  "replayOfExecutionStepId" text,
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "lastHeartbeatAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PipelineStep_runId_pipelineStageId_sequence_idx" ON "PipelineStep"("runId", "pipelineStageId", "sequence");
CREATE INDEX IF NOT EXISTS "PipelineStep_runId_status_idx" ON "PipelineStep"("runId", "status");

CREATE TABLE IF NOT EXISTS "PipelineEventReceipt" (
  "id" text PRIMARY KEY,
  "runId" text NOT NULL REFERENCES "PipelineRun"("id") ON DELETE CASCADE,
  "idempotencyKey" text NOT NULL UNIQUE,
  "eventType" text NOT NULL,
  "eventHash" text NOT NULL,
  "resultJson" text NOT NULL DEFAULT '{}',
  "auditEventId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PipelineEventReceipt_runId_eventType_idx" ON "PipelineEventReceipt"("runId", "eventType");

CREATE TABLE IF NOT EXISTS "PipelineRecordEvent" (
  "id" text PRIMARY KEY,
  "runId" text NOT NULL REFERENCES "PipelineRun"("id") ON DELETE CASCADE,
  "stepId" text REFERENCES "PipelineStep"("id") ON DELETE SET NULL,
  "attemptId" text NOT NULL,
  "pipelineRecordId" text NOT NULL,
  "sourceRecordKey" text,
  "sourceRowNumber" integer,
  "sourceSha256" text,
  "docId" text,
  "picId" text,
  "factId" text,
  "sourceDocIdsJson" text NOT NULL DEFAULT '[]',
  "sourcePicIdsJson" text NOT NULL DEFAULT '[]',
  "destinationRecordId" text,
  "status" text NOT NULL,
  "failureCode" text,
  "errorRef" text,
  "retryable" boolean,
  "tagIdsJson" text NOT NULL DEFAULT '[]',
  "identityRefsJson" text NOT NULL DEFAULT '{}',
  "idempotencyKey" text NOT NULL UNIQUE,
  "auditEventId" text,
  "replayOfPipelineRecordId" text,
  "occurredAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PipelineRecordEvent_runId_status_idx" ON "PipelineRecordEvent"("runId", "status");
CREATE INDEX IF NOT EXISTS "PipelineRecordEvent_pipelineRecordId_idx" ON "PipelineRecordEvent"("pipelineRecordId");
CREATE INDEX IF NOT EXISTS "PipelineRecordEvent_docId_idx" ON "PipelineRecordEvent"("docId");
CREATE INDEX IF NOT EXISTS "PipelineRecordEvent_picId_idx" ON "PipelineRecordEvent"("picId");
CREATE INDEX IF NOT EXISTS "PipelineRecordEvent_factId_idx" ON "PipelineRecordEvent"("factId");

CREATE TABLE IF NOT EXISTS "PipelineReconciliation" (
  "id" text PRIMARY KEY,
  "runId" text NOT NULL REFERENCES "PipelineRun"("id") ON DELETE CASCADE,
  "stepId" text REFERENCES "PipelineStep"("id") ON DELETE SET NULL,
  "expectedCount" integer NOT NULL DEFAULT 0,
  "actualCount" integer NOT NULL DEFAULT 0,
  "insertedCount" integer NOT NULL DEFAULT 0,
  "updatedCount" integer NOT NULL DEFAULT 0,
  "unchangedCount" integer NOT NULL DEFAULT 0,
  "rejectedCount" integer NOT NULL DEFAULT 0,
  "duplicateCount" integer NOT NULL DEFAULT 0,
  "sourceSha256" text,
  "artifactSha256" text,
  "stagingHash" text,
  "destinationHash" text,
  "rlsProbeResult" text,
  "isolationResult" text,
  "result" text NOT NULL,
  "evidenceJson" text NOT NULL DEFAULT '{}',
  "auditEventId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PipelineReconciliation_runId_result_idx" ON "PipelineReconciliation"("runId", "result");
CREATE INDEX IF NOT EXISTS "PipelineReconciliation_stepId_idx" ON "PipelineReconciliation"("stepId");

CREATE TABLE IF NOT EXISTS "PipelineGateDecision" (
  "id" text PRIMARY KEY,
  "runId" text NOT NULL REFERENCES "PipelineRun"("id") ON DELETE CASCADE,
  "gateId" text,
  "status" text NOT NULL,
  "required" boolean NOT NULL DEFAULT true,
  "decidedByPersonId" text,
  "reason" text,
  "evidenceJson" text NOT NULL DEFAULT '{}',
  "auditEventId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PipelineGateDecision_runId_status_idx" ON "PipelineGateDecision"("runId", "status");
CREATE INDEX IF NOT EXISTS "PipelineGateDecision_gateId_idx" ON "PipelineGateDecision"("gateId");

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'PipelineRun', 'PipelineStep', 'PipelineEventReceipt',
    'PipelineRecordEvent', 'PipelineReconciliation', 'PipelineGateDecision'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

REVOKE ALL ON TABLE
  "PipelineRun", "PipelineStep", "PipelineEventReceipt",
  "PipelineRecordEvent", "PipelineReconciliation", "PipelineGateDecision"
FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "PipelineRun" IS
  'Server-owned SmartGift pipeline execution ledger. Browser/Data API roles have no access; use the Zuri server read model.';

COMMIT;
