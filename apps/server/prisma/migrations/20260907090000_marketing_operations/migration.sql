-- @req FR-161; @spec SDD-089
-- CreateTable
CREATE TABLE "MarketingOperationsIntake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "requiredAt" DATETIME,
    "evidenceReference" TEXT,
    "responsibleOwnerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "MarketingOperationsIntake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingOperationsIntake_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MarketingOperationsIntake_tenantId_businessId_status_idx" ON "MarketingOperationsIntake"("tenantId", "businessId", "status");
CREATE INDEX "MarketingOperationsIntake_businessId_requiredAt_idx" ON "MarketingOperationsIntake"("businessId", "requiredAt");
