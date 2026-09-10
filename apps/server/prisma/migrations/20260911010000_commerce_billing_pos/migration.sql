-- @req FR-186, FR-183 — BusinessBillingProfile stores owner-maintained issuer,
-- VAT and PromptPay configuration; CommerceDocument is an immutable issuance
-- snapshot and CommerceDocumentSequence allocates a Business/type/year number.
-- Branch carries the selected issuer address and tax branch code. POS remains
-- composed from the existing SalesOrder, Payment and StockMovement tables.
-- @spec ADR-065; BR-001; BR-002; SEC-001
-- Additive only: no existing rows are rewritten and no production database is
-- changed by this commit.

ALTER TABLE "Branch" ADD COLUMN "address" TEXT;
ALTER TABLE "Branch" ADD COLUMN "taxBranchCode" TEXT;
ALTER TABLE "LegalEntity" ADD COLUMN "legalAddress" TEXT;

-- CreateTable
CREATE TABLE "BusinessBillingProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatRateBps" INTEGER,
    "vatTreatment" TEXT,
    "taxPolicyVersion" TEXT,
    "taxEffectiveAt" DATETIME,
    "taxVerifiedAt" DATETIME,
    "nonVatDocumentPolicy" TEXT,
    "walkInDocumentPolicy" TEXT,
    "promptPayProvider" TEXT,
    "promptPayTargetType" TEXT,
    "promptPayTarget" TEXT,
    "promptPayActive" BOOLEAN NOT NULL DEFAULT false,
    "promptPayVerifiedAt" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessBillingProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessBillingProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommerceDocumentSequence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "calendarYear" INTEGER NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommerceDocumentSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CommerceDocumentSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommerceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "calendarYear" INTEGER NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByPersonId" TEXT,
    "snapshotJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommerceDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommerceDocument_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommerceDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommerceDocument_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessBillingProfile_businessId_key" ON "BusinessBillingProfile"("businessId");
CREATE INDEX "BusinessBillingProfile_tenantId_idx" ON "BusinessBillingProfile"("tenantId");
CREATE UNIQUE INDEX "CommerceDocumentSequence_businessId_documentType_calendarYear_key" ON "CommerceDocumentSequence"("businessId", "documentType", "calendarYear");
CREATE INDEX "CommerceDocumentSequence_tenantId_businessId_idx" ON "CommerceDocumentSequence"("tenantId", "businessId");
CREATE UNIQUE INDEX "CommerceDocument_businessId_idempotencyKey_key" ON "CommerceDocument"("businessId", "idempotencyKey");
CREATE UNIQUE INDEX "CommerceDocument_businessId_documentNumber_key" ON "CommerceDocument"("businessId", "documentNumber");
CREATE UNIQUE INDEX "CommerceDocument_businessId_documentType_calendarYear_sequenceNumber_key" ON "CommerceDocument"("businessId", "documentType", "calendarYear", "sequenceNumber");
CREATE INDEX "CommerceDocument_businessId_orderId_issuedAt_idx" ON "CommerceDocument"("businessId", "orderId", "issuedAt");
