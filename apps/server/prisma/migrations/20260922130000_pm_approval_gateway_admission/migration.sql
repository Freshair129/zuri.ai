-- @req FR-272 — PM approval request projection for exact-hash admission.
-- @spec ADR-103, PMR-013, PMT-013, SEC-001, SEC-003, SEC-008
-- Additive SQLite migration. Request content is bounded and stores no provider
-- secret or executable payload; state changes are owned by the PM service.

CREATE TABLE "ProjectApprovalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvalRequestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT NOT NULL,
    "executionRunDbId" TEXT NOT NULL,
    "executionStepDbId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "executionStepId" TEXT NOT NULL,
    "actionClass" TEXT NOT NULL,
    "effectKey" TEXT NOT NULL,
    "manifestHash" TEXT,
    "inputHash" TEXT,
    "artifactHashesJson" TEXT NOT NULL DEFAULT '[]',
    "commitSha" TEXT,
    "payloadSummaryJson" TEXT NOT NULL DEFAULT '{}',
    "expectedEffectsJson" TEXT NOT NULL DEFAULT '{}',
    "eligibleReviewerCapability" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "requestedByPersonId" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedByPersonId" TEXT,
    "decidedAt" DATETIME,
    "decisionReason" TEXT,
    "admissionLeaseEpoch" TEXT,
    "admissionReceiptHash" TEXT,
    "admissionExpiresAt" DATETIME,
    "consumedAt" DATETIME,
    "auditEventId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectApprovalRequest_executionRunDbId_fkey" FOREIGN KEY ("executionRunDbId") REFERENCES "ProjectExecutionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectApprovalRequest_executionStepDbId_fkey" FOREIGN KEY ("executionStepDbId") REFERENCES "ProjectExecutionStep" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectApprovalRequest_approvalRequestId_key" ON "ProjectApprovalRequest"("approvalRequestId");
CREATE UNIQUE INDEX "ProjectApprovalRequest_run_step_digest" ON "ProjectApprovalRequest"("executionRunId", "executionStepId", "requestDigest");
CREATE INDEX "ProjectApprovalRequest_tenantId_businessId_projectId_state_expiresAt_idx" ON "ProjectApprovalRequest"("tenantId", "businessId", "projectId", "state", "expiresAt");
CREATE INDEX "ProjectApprovalRequest_executionRunId_executionStepId_state_idx" ON "ProjectApprovalRequest"("executionRunId", "executionStepId", "state");
CREATE INDEX "ProjectApprovalRequest_requestedByPersonId_idx" ON "ProjectApprovalRequest"("requestedByPersonId");
