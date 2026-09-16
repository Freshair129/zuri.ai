-- @req FR-184 — durable NONE/LOT stocktake observations and the shared
-- Inventory ledger fence. This additive migration is a release artifact; it is
-- not applied to production by this change.
-- @spec ADR-074 D1, D2; BR-002, BR-008, BR-012, BR-026; SEC-001

-- CreateTable
CREATE TABLE "InventoryLedgerFence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mutationRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryLedgerFence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryLedgerFence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryStocktake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "normalizedLinesJson" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
    "resultJson" TEXT,
    "committedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "InventoryStocktake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryStocktake_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLedgerFence_tenantId_businessId_key" ON "InventoryLedgerFence"("tenantId", "businessId");
CREATE INDEX "InventoryLedgerFence_businessId_idx" ON "InventoryLedgerFence"("businessId");
CREATE UNIQUE INDEX "InventoryStocktake_tenantId_businessId_idempotencyKey_key" ON "InventoryStocktake"("tenantId", "businessId", "idempotencyKey");
CREATE INDEX "InventoryStocktake_businessId_status_createdAt_idx" ON "InventoryStocktake"("businessId", "status", "createdAt");
