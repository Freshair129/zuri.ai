-- CRM peer compatibility: SQLite twin of the approved CustomerLegalHold table.
-- @req FR-245
-- @spec ADR-093 D6
CREATE TABLE "CustomerLegalHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "endDate" DATETIME NOT NULL,
    "recordedByPersonId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerLegalHold_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerLegalHold_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerLegalHold_recordedByPersonId_fkey" FOREIGN KEY ("recordedByPersonId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CustomerLegalHold_tenantId_idx" ON "CustomerLegalHold"("tenantId");
CREATE INDEX "CustomerLegalHold_customerId_endDate_idx" ON "CustomerLegalHold"("customerId", "endDate");
