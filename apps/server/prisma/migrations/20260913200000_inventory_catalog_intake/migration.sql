-- @req FR-208 — InventoryCatalogIntake: one persisted catalogue intake preview
-- and its committed result. Every surface (JSON, Excel, LINE) converts into one
-- envelope; this row keeps the normalized envelope, the plan made after
-- resolving every item against the catalogue, and the planHash a commit must
-- match. Idempotent on (businessId, sourceChannel, sourceCorrelationId).
-- @spec ADR-084 D1, D2; BR-009, BR-041; SDD-009
-- Additive. This is the local twin of supabase/migrations/20260913200000_inventory_catalog_intake.sql.

-- CreateTable
CREATE TABLE "InventoryCatalogIntake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceChannel" TEXT NOT NULL,
    "sourceCorrelationId" TEXT NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "normalizedEnvelopeJson" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "committable" BOOLEAN NOT NULL DEFAULT false,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
    "requestedById" TEXT,
    "resultJson" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "committedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "InventoryCatalogIntake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryCatalogIntake_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCatalogIntake_businessId_sourceChannel_sourceCorrelationId_key" ON "InventoryCatalogIntake"("businessId", "sourceChannel", "sourceCorrelationId");
CREATE UNIQUE INDEX "InventoryCatalogIntake_tenantId_code_key" ON "InventoryCatalogIntake"("tenantId", "code");
CREATE INDEX "InventoryCatalogIntake_businessId_status_createdAt_idx" ON "InventoryCatalogIntake"("businessId", "status", "createdAt");
