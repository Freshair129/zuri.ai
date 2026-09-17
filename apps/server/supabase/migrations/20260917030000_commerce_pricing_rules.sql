-- NOT APPLIED to production. Owner-directed ADR-057 dry run/deployment required.
BEGIN;

-- @req FR-253 — additive rule versions and immutable calculation snapshots.
-- @spec ADR-098
CREATE TABLE IF NOT EXISTS "PricingRuleSet" (
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
  "approvedAt" TIMESTAMP(3),
  "effectiveFrom" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "approvalReason" TEXT,
  "revokedByPersonId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "PricingRuleSet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PricingRuleSet_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PricingRuleSet_sourceRuleSetId_fkey" FOREIGN KEY ("sourceRuleSetId") REFERENCES "PricingRuleSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "PricingCalculation" (
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
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PricingCalculation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PricingCalculation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PricingCalculation_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "PricingRuleSet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PricingRuleSet_tenantId_businessId_idx" ON "PricingRuleSet"("tenantId", "businessId");
CREATE INDEX IF NOT EXISTS "PricingRuleSet_businessId_effectiveFrom_approvedAt_idx" ON "PricingRuleSet"("businessId", "effectiveFrom", "approvedAt");
CREATE INDEX IF NOT EXISTS "PricingRuleSet_sourceRuleSetId_idx" ON "PricingRuleSet"("sourceRuleSetId");
CREATE UNIQUE INDEX IF NOT EXISTS "PricingCalculation_businessId_idempotencyKey_key" ON "PricingCalculation"("businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "PricingCalculation_tenantId_businessId_idx" ON "PricingCalculation"("tenantId", "businessId");
CREATE INDEX IF NOT EXISTS "PricingCalculation_ruleSetId_idx" ON "PricingCalculation"("ruleSetId");
-- Runtime writes are authorized by the scoped application port; browser roles
-- receive no raw table access. Content is never exposed through anon/authenticated.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['PricingRuleSet', 'PricingCalculation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format('CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I FROM public, anon, authenticated, service_role', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON TABLE "PricingRuleSet" TO zuri_app_runtime, zuri_web_login;
GRANT SELECT, INSERT ON TABLE "PricingCalculation" TO zuri_app_runtime, zuri_web_login;

COMMIT;
