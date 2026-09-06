-- @req FR-161; @spec SDD-089, SEC-001, SEC-003
BEGIN;

CREATE TABLE "MarketingOperationsIntake" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "requiredAt" TIMESTAMP(3),
    "evidenceReference" TEXT,
    "responsibleOwnerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "MarketingOperationsIntake_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingOperationsIntake_tenantId_businessId_status_idx" ON "MarketingOperationsIntake"("tenantId", "businessId", "status");
CREATE INDEX "MarketingOperationsIntake_businessId_requiredAt_idx" ON "MarketingOperationsIntake"("businessId", "requiredAt");

ALTER TABLE "MarketingOperationsIntake" ADD CONSTRAINT "MarketingOperationsIntake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingOperationsIntake" ADD CONSTRAINT "MarketingOperationsIntake_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MarketingOperationsIntake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingOperationsIntake" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingOperationsIntake" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingOperationsIntake" FROM public, anon, authenticated, service_role;
COMMIT;
