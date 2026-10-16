-- @req FR-026 — Agent-owned human approval prerequisite ledger.
-- Source only. Never apply this migration as part of TASK-ZAI-010 local implementation.
CREATE TABLE public."AgentApprovalRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requesterPersonId" TEXT NOT NULL,
    "requesterExternalIdentityId" TEXT NOT NULL,
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
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "AgentApprovalRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentApprovalRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_requesterPersonId_fkey" FOREIGN KEY ("requesterPersonId") REFERENCES public."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_requesterExternalIdentityId_fkey" FOREIGN KEY ("requesterExternalIdentityId") REFERENCES public."ExternalIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES public."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE public."AgentApprovalDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "AgentApprovalDecision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES public."AgentApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalDecision_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES public."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentApprovalDecision_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentApprovalDecision_request_person_key" ON public."AgentApprovalDecision"("requestId", "personId");
CREATE INDEX "AgentApprovalRequest_tenantId_businessId_status_expiresAt_idx" ON public."AgentApprovalRequest"("tenantId", "businessId", "status", "expiresAt");
CREATE INDEX "AgentApprovalRequest_requesterPersonId_createdAt_idx" ON public."AgentApprovalRequest"("requesterPersonId", "createdAt");
CREATE INDEX "AgentApprovalDecision_tenantId_businessId_createdAt_idx" ON public."AgentApprovalDecision"("tenantId", "businessId", "createdAt");

ALTER TABLE public."AgentApprovalRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgentApprovalRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."AgentApprovalDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgentApprovalDecision" FORCE ROW LEVEL SECURITY;

CREATE POLICY zuri_app_runtime_all ON public."AgentApprovalRequest"
  FOR ALL TO zuri_app_runtime USING (true) WITH CHECK (true);
CREATE POLICY zuri_app_runtime_all ON public."AgentApprovalDecision"
  FOR ALL TO zuri_app_runtime USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public."AgentApprovalRequest", public."AgentApprovalDecision"
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AgentApprovalRequest", public."AgentApprovalDecision"
  TO zuri_app_runtime;
