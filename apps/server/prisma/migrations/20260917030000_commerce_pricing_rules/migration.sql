-- @req FR-252 — additive rule versions and immutable calculation snapshots.
-- @spec ADR-097
CREATE TABLE "PricingRuleSet" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "rulesJson" TEXT NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "sourceRuleSetId" TEXT,
  "createdByPersonId" TEXT,
  "approvedByPersonId" TEXT,
  "approvedAt" DATETIME,
  "effectiveFrom" DATETIME,
  "expiresAt" DATETIME,
  "approvalReason" TEXT,
  "revokedByPersonId" TEXT,
  "revokedAt" DATETIME,
  "revocationReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "PricingRuleSet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PricingRuleSet_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PricingRuleSet_sourceRuleSetId_fkey" FOREIGN KEY ("sourceRuleSetId") REFERENCES "PricingRuleSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PricingCalculation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "ruleSetId" TEXT NOT NULL,
  "ruleVersion" INTEGER NOT NULL,
  "rulesHash" TEXT NOT NULL,
  "rulesJson" TEXT NOT NULL,
  "evaluatorVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "inputJson" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL,
  "inputProvenance" TEXT NOT NULL DEFAULT 'USER_ENTERED',
  "requestHash" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByPersonId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingCalculation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PricingCalculation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PricingCalculation_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "PricingRuleSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PricingRuleSet_tenantId_businessId_idx" ON "PricingRuleSet"("tenantId", "businessId");
CREATE INDEX "PricingRuleSet_businessId_effectiveFrom_approvedAt_idx" ON "PricingRuleSet"("businessId", "effectiveFrom", "approvedAt");
CREATE INDEX "PricingRuleSet_sourceRuleSetId_idx" ON "PricingRuleSet"("sourceRuleSetId");
CREATE UNIQUE INDEX "PricingCalculation_businessId_idempotencyKey_key" ON "PricingCalculation"("businessId", "idempotencyKey");
CREATE INDEX "PricingCalculation_tenantId_businessId_idx" ON "PricingCalculation"("tenantId", "businessId");
CREATE INDEX "PricingCalculation_ruleSetId_idx" ON "PricingCalculation"("ruleSetId");
