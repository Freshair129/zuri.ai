-- @req FR-186, FR-183 — BusinessBillingProfile stores owner-maintained issuer,
-- VAT and PromptPay configuration; CommerceDocument is an immutable issuance
-- snapshot and CommerceDocumentSequence allocates a Business/type/year number.
-- Branch carries the selected issuer address and tax branch code. POS remains
-- composed from the existing SalesOrder, Payment and StockMovement tables.
-- @spec ADR-065; BR-001; BR-002; SEC-001
-- Additive and idempotent. This file is a release artifact only; it is not
-- applied to production by this change.

BEGIN;

ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "taxBranchCode" TEXT;
ALTER TABLE "LegalEntity" ADD COLUMN IF NOT EXISTS "legalAddress" TEXT;

CREATE TABLE IF NOT EXISTS "BusinessBillingProfile" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
  "vatRateBps" INTEGER,
  "vatTreatment" TEXT,
  "taxPolicyVersion" TEXT,
  "taxEffectiveAt" TIMESTAMP(3),
  "taxVerifiedAt" TIMESTAMP(3),
  "nonVatDocumentPolicy" TEXT,
  "walkInDocumentPolicy" TEXT,
  "promptPayProvider" TEXT,
  "promptPayTargetType" TEXT,
  "promptPayTarget" TEXT,
  "promptPayActive" BOOLEAN NOT NULL DEFAULT false,
  "promptPayVerifiedAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "CommerceDocumentSequence" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "documentType" TEXT NOT NULL,
  "calendarYear" INTEGER NOT NULL,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "CommerceDocument" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderId" TEXT NOT NULL REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "branchId" TEXT NOT NULL REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "documentType" TEXT NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "calendarYear" INTEGER NOT NULL,
  "sequenceNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ISSUED',
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "issuedByPersonId" TEXT,
  "snapshotJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessBillingProfile_businessId_key" ON "BusinessBillingProfile"("businessId");
CREATE INDEX IF NOT EXISTS "BusinessBillingProfile_tenantId_idx" ON "BusinessBillingProfile"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceDocumentSequence_businessId_documentType_calendarYe_key" ON "CommerceDocumentSequence"("businessId", "documentType", "calendarYear");
CREATE INDEX IF NOT EXISTS "CommerceDocumentSequence_tenantId_businessId_idx" ON "CommerceDocumentSequence"("tenantId", "businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceDocument_businessId_idempotencyKey_key" ON "CommerceDocument"("businessId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceDocument_businessId_documentNumber_key" ON "CommerceDocument"("businessId", "documentNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceDocument_businessId_documentType_calendarYear_seque_key" ON "CommerceDocument"("businessId", "documentType", "calendarYear", "sequenceNumber");
CREATE INDEX IF NOT EXISTS "CommerceDocument_businessId_orderId_issuedAt_idx" ON "CommerceDocument"("businessId", "orderId", "issuedAt");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['BusinessBillingProfile', 'CommerceDocumentSequence', 'CommerceDocument'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format('CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I FROM public, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO zuri_app_runtime, zuri_web_login', t);
  END LOOP;
END $$;

COMMENT ON TABLE "BusinessBillingProfile" IS 'FR-186 — owner-maintained issuer, tax policy and verified PromptPay target; absent values are an explicit unavailable state.';
COMMENT ON TABLE "CommerceDocumentSequence" IS 'FR-186 — atomic Business/document type/calendar year sequence allocator.';
COMMENT ON TABLE "CommerceDocument" IS 'FR-186 — immutable local issuance snapshot with Business-scoped idempotency and number.';

COMMIT;
