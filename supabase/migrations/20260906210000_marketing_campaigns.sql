-- @req FR-156; @spec SDD-087, SEC-001 — Campaign association; application-owned access.
BEGIN;
-- CreateTable
CREATE TABLE "MarketingInitiative" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "handoffId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closureReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingInitiative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingInitiative_planId_key" ON "MarketingInitiative"("planId");

-- CreateIndex
CREATE INDEX "MarketingInitiative_tenantId_businessId_status_idx" ON "MarketingInitiative"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingInitiative_businessId_code_key" ON "MarketingInitiative"("businessId", "code");

-- AddForeignKey
ALTER TABLE "MarketingInitiative" ADD CONSTRAINT "MarketingInitiative_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInitiative" ADD CONSTRAINT "MarketingInitiative_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInitiative" ADD CONSTRAINT "MarketingInitiative_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInitiative" ADD CONSTRAINT "MarketingInitiative_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "MarketingHandoff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketingInitiative" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingInitiative" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingInitiative" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingInitiative" FROM public, anon, authenticated, service_role;
COMMIT;
