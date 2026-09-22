-- @req FR-272 — PM approval request projection for exact-hash admission.
-- @spec ADR-103, PMR-013, PMT-013, SEC-001, SEC-003, SEC-008
-- Provider twin of the additive Prisma/SQLite migration. The application
-- service is the only writer; the table carries no provider secrets.

BEGIN;

CREATE TABLE IF NOT EXISTS "ProjectApprovalRequest" (
  "id" text PRIMARY KEY,
  "approvalRequestId" text NOT NULL UNIQUE,
  "tenantId" text NOT NULL,
  "businessId" text NOT NULL,
  "workspaceId" text,
  "projectId" text NOT NULL,
  "executionRunDbId" text NOT NULL REFERENCES "ProjectExecutionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "executionStepDbId" text NOT NULL REFERENCES "ProjectExecutionStep"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "executionRunId" text NOT NULL,
  "executionStepId" text NOT NULL,
  "actionClass" text NOT NULL,
  "effectKey" text NOT NULL,
  "manifestHash" text,
  "inputHash" text,
  "artifactHashesJson" text NOT NULL DEFAULT '[]',
  "commitSha" text,
  "payloadSummaryJson" text NOT NULL DEFAULT '{}',
  "expectedEffectsJson" text NOT NULL DEFAULT '{}',
  "eligibleReviewerCapability" text NOT NULL,
  "policyVersion" text NOT NULL,
  "requestedByPersonId" text NOT NULL,
  "requestedAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz NOT NULL,
  "requestDigest" text NOT NULL,
  "state" text NOT NULL DEFAULT 'PENDING',
  "decidedByPersonId" text,
  "decidedAt" timestamptz,
  "decisionReason" text,
  "admissionLeaseEpoch" text,
  "admissionReceiptHash" text,
  "admissionExpiresAt" timestamptz,
  "consumedAt" timestamptz,
  "auditEventId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectApprovalRequest_run_step_digest"
  ON "ProjectApprovalRequest"("executionRunId", "executionStepId", "requestDigest");
CREATE INDEX IF NOT EXISTS "ProjectApprovalRequest_tenantId_businessId_projectId_state_expiresAt_idx"
  ON "ProjectApprovalRequest"("tenantId", "businessId", "projectId", "state", "expiresAt");
CREATE INDEX IF NOT EXISTS "ProjectApprovalRequest_executionRunId_executionStepId_state_idx"
  ON "ProjectApprovalRequest"("executionRunId", "executionStepId", "state");
CREATE INDEX IF NOT EXISTS "ProjectApprovalRequest_requestedByPersonId_idx"
  ON "ProjectApprovalRequest"("requestedByPersonId");

ALTER TABLE "ProjectApprovalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectApprovalRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "ProjectApprovalRequest"
  FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "ProjectApprovalRequest"
FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ProjectApprovalRequest"
TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "ProjectApprovalRequest" IS
  'Project Manager exact-hash approval intent and admission state; no provider secret or executable payload.';

COMMIT;
