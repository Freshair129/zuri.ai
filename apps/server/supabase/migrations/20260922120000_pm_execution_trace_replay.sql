-- @req FR-069, FR-070 — PM-owned execution trace and append-only replay.
-- @spec ADR-102, ADR-029, SDD-041, SEC-003, SEC-008
-- Provider twin of the additive Prisma/SQLite migration. Scope and business
-- references stay scalar; the PM trace is not a second business-work graph.

BEGIN;

CREATE TABLE IF NOT EXISTS "ProjectExecutionRun" (
  "id" text PRIMARY KEY,
  "executionRunId" text NOT NULL UNIQUE,
  "executionContractId" text NOT NULL,
  "contractVersion" text NOT NULL,
  "sourceKind" text NOT NULL,
  "tenantId" text,
  "businessId" text,
  "workspaceId" text,
  "projectId" text,
  "projectIdsJson" text NOT NULL DEFAULT '[]',
  "planId" text,
  "status" text NOT NULL DEFAULT 'RUNNING',
  "correlationId" text NOT NULL,
  "idempotencyKey" text,
  "requestHash" text NOT NULL,
  "inputSnapshotJson" text NOT NULL,
  "snapshotState" text NOT NULL DEFAULT 'RETAINED',
  "tagIdsJson" text NOT NULL DEFAULT '[]',
  "identityRefsJson" text NOT NULL DEFAULT '{}',
  "failureCode" text,
  "errorRef" text,
  "retryable" boolean,
  "auditEventId" text,
  "replayOfExecutionRunId" text,
  "replayOfExecutionStepId" text,
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "finishedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectExecutionRun_business_idempotency_key"
  ON "ProjectExecutionRun"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ProjectExecutionRun_tenantId_businessId_status_createdAt_idx"
  ON "ProjectExecutionRun"("tenantId", "businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectExecutionRun_projectId_createdAt_idx"
  ON "ProjectExecutionRun"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectExecutionRun_correlationId_idx"
  ON "ProjectExecutionRun"("correlationId");
CREATE INDEX IF NOT EXISTS "ProjectExecutionRun_replayOfExecutionRunId_idx"
  ON "ProjectExecutionRun"("replayOfExecutionRunId");

CREATE TABLE IF NOT EXISTS "ProjectExecutionStep" (
  "id" text PRIMARY KEY,
  "executionStepId" text NOT NULL UNIQUE,
  "runId" text NOT NULL REFERENCES "ProjectExecutionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "executionContractId" text NOT NULL,
  "stepKey" text NOT NULL,
  "sequence" integer NOT NULL,
  "attemptId" text NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'NOT_STARTED',
  "tenantId" text,
  "businessId" text,
  "workspaceId" text,
  "projectId" text,
  "planId" text,
  "containerId" text,
  "workItemId" text,
  "inputHash" text,
  "outputHash" text,
  "tagIdsJson" text NOT NULL DEFAULT '[]',
  "identityRefsJson" text NOT NULL DEFAULT '{}',
  "failureCode" text,
  "errorRef" text,
  "retryable" boolean,
  "skippedReason" text,
  "auditEventId" text,
  "replayOfExecutionStepId" text,
  "startedAt" timestamptz,
  "finishedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ProjectExecutionStep_runId_sequence_idx"
  ON "ProjectExecutionStep"("runId", "sequence");
CREATE INDEX IF NOT EXISTS "ProjectExecutionStep_runId_status_idx"
  ON "ProjectExecutionStep"("runId", "status");
CREATE INDEX IF NOT EXISTS "ProjectExecutionStep_tenantId_businessId_projectId_status_idx"
  ON "ProjectExecutionStep"("tenantId", "businessId", "projectId", "status");
CREATE INDEX IF NOT EXISTS "ProjectExecutionStep_replayOfExecutionStepId_idx"
  ON "ProjectExecutionStep"("replayOfExecutionStepId");

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ProjectExecutionRun', 'ProjectExecutionStep'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

REVOKE ALL ON TABLE "ProjectExecutionRun", "ProjectExecutionStep"
FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "ProjectExecutionRun" IS
  'Project Manager execution run ledger; read and replay through the Zuri server service.';
COMMENT ON TABLE "ProjectExecutionStep" IS
  'Project Manager ordered step and attempt evidence; source rows are immutable under replay.';

COMMIT;
