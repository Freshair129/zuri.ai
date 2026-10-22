-- TASK-ZAI-011 — durable in-app outcomes for Agent approval decisions.
CREATE TABLE "AgentApprovalNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "recipientPersonId" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" DATETIME,
    CONSTRAINT "AgentApprovalNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalNotification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalNotification_recipientPersonId_fkey" FOREIGN KEY ("recipientPersonId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalNotification_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "AgentApprovalRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalNotification_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentApprovalDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentApprovalNotification_decision_recipient_key" ON "AgentApprovalNotification"("decisionId", "recipientPersonId");
CREATE INDEX "AgentApprovalNotification_recipient_read_created_idx" ON "AgentApprovalNotification"("recipientPersonId", "readAt", "createdAt");
CREATE INDEX "AgentApprovalNotification_scope_created_idx" ON "AgentApprovalNotification"("tenantId", "businessId", "createdAt");
