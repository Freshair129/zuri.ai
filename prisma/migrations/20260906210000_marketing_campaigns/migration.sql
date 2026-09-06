-- @req FR-156; @spec SDD-087 — Campaign association within Marketing.
-- CreateTable
CREATE TABLE "MarketingInitiative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "handoffId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closureReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "MarketingInitiative_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingInitiative_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingInitiative_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingInitiative_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "MarketingHandoff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingInitiative_planId_key" ON "MarketingInitiative"("planId");

-- CreateIndex
CREATE INDEX "MarketingInitiative_tenantId_businessId_status_idx" ON "MarketingInitiative"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingInitiative_businessId_code_key" ON "MarketingInitiative"("businessId", "code");
