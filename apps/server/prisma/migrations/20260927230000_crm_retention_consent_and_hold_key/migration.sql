-- CRM peer compatibility: SQLite twin of the approved CustomerRetentionConsent
-- and LegalHoldArchiveKey tables.
-- @req FR-022
-- @spec ADR-093 1.2.0
CREATE TABLE "CustomerRetentionConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "recordedByPersonId" TEXT NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "revokedAt" DATETIME,
    "revokedByPersonId" TEXT,
    CONSTRAINT "CustomerRetentionConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerRetentionConsent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerRetentionConsent_recordedByPersonId_fkey" FOREIGN KEY ("recordedByPersonId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CustomerRetentionConsent_tenantId_idx" ON "CustomerRetentionConsent"("tenantId");
CREATE INDEX "CustomerRetentionConsent_customerId_revokedAt_idx" ON "CustomerRetentionConsent"("customerId", "revokedAt");

CREATE TABLE "LegalHoldArchiveKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "legalHoldId" TEXT NOT NULL,
    "heldCustomerId" TEXT NOT NULL,
    "kekId" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "LegalHoldArchiveKey_legalHoldId_key" ON "LegalHoldArchiveKey"("legalHoldId");
CREATE INDEX "LegalHoldArchiveKey_tenantId_idx" ON "LegalHoldArchiveKey"("tenantId");
CREATE INDEX "LegalHoldArchiveKey_heldCustomerId_idx" ON "LegalHoldArchiveKey"("heldCustomerId");
