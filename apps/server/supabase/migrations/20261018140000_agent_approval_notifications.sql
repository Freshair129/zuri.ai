-- TASK-ZAI-011 — durable in-app outcomes for Agent approval decisions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

CREATE TABLE public."AgentApprovalNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "recipientPersonId" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "AgentApprovalNotification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentApprovalNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalNotification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalNotification_recipientPersonId_fkey" FOREIGN KEY ("recipientPersonId") REFERENCES public."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalNotification_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES public."AgentApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalNotification_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES public."AgentApprovalDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentApprovalNotification_decision_recipient_key" ON public."AgentApprovalNotification"("decisionId", "recipientPersonId");
CREATE INDEX "AgentApprovalNotification_recipient_read_created_idx" ON public."AgentApprovalNotification"("recipientPersonId", "readAt", "createdAt");
CREATE INDEX "AgentApprovalNotification_scope_created_idx" ON public."AgentApprovalNotification"("tenantId", "businessId", "createdAt");

ALTER TABLE public."AgentApprovalNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgentApprovalNotification" FORCE ROW LEVEL SECURITY;

CREATE POLICY zuri_app_runtime_all ON public."AgentApprovalNotification"
  FOR ALL TO zuri_app_runtime USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public."AgentApprovalNotification"
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AgentApprovalNotification"
  TO zuri_app_runtime;

commit;
