-- @req FR-159, FR-158 — private Marketing evidence and PM receipt associations.
-- @spec SDD-086, SEC-001, ADR-057 — same runtime-only table posture as sibling domains.
-- Additive migration; NOT applied to production. Execute through the migration ledger.
BEGIN;

-- CreateTable
CREATE TABLE "MarketingPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlanVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingReview" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDecision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "reviewId" TEXT,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingHandoff" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "envelopeHash" TEXT NOT NULL,
    "receiptJson" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingPlan_tenantId_businessId_status_idx" ON "MarketingPlan"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlan_businessId_code_key" ON "MarketingPlan"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlanVersion_planId_revision_key" ON "MarketingPlanVersion"("planId", "revision");

-- CreateIndex
CREATE INDEX "MarketingReview_planId_createdAt_idx" ON "MarketingReview"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingDecision_planId_createdAt_idx" ON "MarketingDecision"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingHandoff_planId_idx" ON "MarketingHandoff"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingHandoff_planVersionId_workspaceId_key" ON "MarketingHandoff"("planVersionId", "workspaceId");

-- AddForeignKey
ALTER TABLE "MarketingPlan" ADD CONSTRAINT "MarketingPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlan" ADD CONSTRAINT "MarketingPlan_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanVersion" ADD CONSTRAINT "MarketingPlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingReview" ADD CONSTRAINT "MarketingReview_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingReview" ADD CONSTRAINT "MarketingReview_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDecision" ADD CONSTRAINT "MarketingDecision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDecision" ADD CONSTRAINT "MarketingDecision_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDecision" ADD CONSTRAINT "MarketingDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "MarketingReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingHandoff" ADD CONSTRAINT "MarketingHandoff_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingHandoff" ADD CONSTRAINT "MarketingHandoff_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingHandoff" ADD CONSTRAINT "MarketingHandoff_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingHandoff" ADD CONSTRAINT "MarketingHandoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant/Business authorization is enforced by the application runtime; no direct Data API access.
ALTER TABLE "MarketingPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingPlan" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingPlan" FROM public, anon, authenticated, service_role;

ALTER TABLE "MarketingPlanVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingPlanVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingPlanVersion" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingPlanVersion" FROM public, anon, authenticated, service_role;

ALTER TABLE "MarketingReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingReview" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingReview" FROM public, anon, authenticated, service_role;

ALTER TABLE "MarketingDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingDecision" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingDecision" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingDecision" FROM public, anon, authenticated, service_role;

ALTER TABLE "MarketingHandoff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingHandoff" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingHandoff" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingHandoff" FROM public, anon, authenticated, service_role;

COMMIT;
