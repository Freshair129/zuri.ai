CREATE TABLE "AgentApprovalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requesterPersonId" TEXT NOT NULL,
    "actionName" TEXT NOT NULL,
    "tier" INTEGER NOT NULL,
    "quorum" INTEGER NOT NULL,
    "targetKind" TEXT NOT NULL,
    "conversationId" TEXT,
    "customerId" TEXT,
    "targetVersion" TEXT NOT NULL,
    "inputSummaryJson" TEXT NOT NULL DEFAULT '{}',
    "inputDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "AgentApprovalRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_requesterPersonId_fkey" FOREIGN KEY ("requesterPersonId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AgentApprovalDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "AgentApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AgentApprovalRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalDecision_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalDecision_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentApprovalDecision_request_person_key" ON "AgentApprovalDecision"("requestId", "personId");
CREATE INDEX "AgentApprovalRequest_tenantId_businessId_status_expiresAt_idx" ON "AgentApprovalRequest"("tenantId", "businessId", "status", "expiresAt");
CREATE INDEX "AgentApprovalRequest_requesterPersonId_createdAt_idx" ON "AgentApprovalRequest"("requesterPersonId", "createdAt");
CREATE INDEX "AgentApprovalDecision_tenantId_businessId_createdAt_idx" ON "AgentApprovalDecision"("tenantId", "businessId", "createdAt");
