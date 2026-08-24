-- FR-096: the SoT pipeline's generic human-decision queue. The data plane
-- submits, a human decides, the data plane pulls by cursor — zuri-ai never
-- writes into the retrieval substrate (ADR-043 interim boundary).
CREATE TABLE "SotDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT,
  "decisionType" TEXT NOT NULL,
  "subjectRef" TEXT NOT NULL,
  "phaseId" TEXT,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "payloadSha256" TEXT NOT NULL,
  "decisionVersion" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "submittedBy" TEXT,
  "decidedByPersonId" TEXT,
  "reason" TEXT,
  "auditEventId" TEXT,
  "decidedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "SotDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SotDecision_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SotDecision_tenantId_decisionType_subjectRef_decisionVersion_key" ON "SotDecision"("tenantId", "decisionType", "subjectRef", "decisionVersion");
CREATE INDEX "SotDecision_tenantId_status_decisionType_idx" ON "SotDecision"("tenantId", "status", "decisionType");
CREATE INDEX "SotDecision_businessId_status_idx" ON "SotDecision"("businessId", "status");
CREATE INDEX "SotDecision_phaseId_status_idx" ON "SotDecision"("phaseId", "status");
CREATE INDEX "SotDecision_updatedAt_idx" ON "SotDecision"("updatedAt");
