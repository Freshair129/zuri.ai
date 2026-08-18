-- FR-069 / FR-070: additive stable execution identity on Workstream plus
-- server-owned PlanEnvelope idempotency receipts.
ALTER TABLE "Workstream" ADD COLUMN "executionModeId" TEXT;
ALTER TABLE "Workstream" ADD COLUMN "executionContractId" TEXT;
ALTER TABLE "Workstream" ADD COLUMN "contractVersion" TEXT;
ALTER TABLE "Workstream" ADD COLUMN "primaryDomainId" TEXT;
ALTER TABLE "Workstream" ADD COLUMN "supportingDomainIdsJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Workstream" ADD COLUMN "technicalOwnerDomainId" TEXT;
ALTER TABLE "Workstream" ADD COLUMN "identityRefsJson" TEXT NOT NULL DEFAULT '{}';

CREATE INDEX "Workstream_executionModeId_idx" ON "Workstream"("executionModeId");

CREATE TABLE "PlanImportReceipt" (
  "idempotencyKey" TEXT NOT NULL PRIMARY KEY,
  "payloadHash" TEXT NOT NULL,
  "executionRunId" TEXT NOT NULL,
  "executionStepId" TEXT,
  "attemptId" TEXT,
  "stepKey" TEXT NOT NULL DEFAULT 'plan.import.commit',
  "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
  "correlationId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "replayOfExecutionRunId" TEXT,
  "replayOfExecutionStepId" TEXT,
  "auditEventId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanImportReceipt_executionRunId_key" UNIQUE ("executionRunId"),
  CONSTRAINT "PlanImportReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PlanImportReceipt_projectId_idx" ON "PlanImportReceipt"("projectId");
CREATE INDEX "PlanImportReceipt_correlationId_idx" ON "PlanImportReceipt"("correlationId");
CREATE INDEX "PlanImportReceipt_replayOfExecutionRunId_idx" ON "PlanImportReceipt"("replayOfExecutionRunId");
