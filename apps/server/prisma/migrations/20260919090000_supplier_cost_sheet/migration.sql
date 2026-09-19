-- @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
-- SupplierCostSheet stores the locked FX/source preview; SupplierCostLine is
-- created only after a person confirms each product mapping. Product carton
-- fields are nullable so existing catalogues remain valid and hygiene reports
-- the missing data.
-- Additive local twin of the Supabase migration with the same timestamp.

ALTER TABLE "Product" ADD COLUMN "unitsPerCarton" INTEGER;
ALTER TABLE "Product" ADD COLUMN "cartonCbm" REAL;
ALTER TABLE "Product" ADD COLUMN "cartonKg" REAL;
ALTER TABLE "Product" ADD COLUMN "freightGoodsType" TEXT;

CREATE TABLE "SupplierCostSheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "fxRateLocked" REAL NOT NULL,
    "sourceRef" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "previewHash" TEXT NOT NULL,
    "previewJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "createdByPersonId" TEXT,
    "confirmedByPersonId" TEXT,
    "confirmedAt" DATETIME,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "SupplierCostSheet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierCostSheet_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierCostSheet_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SupplierCostLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sheetId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceSku" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "unitCostForeign" REAL NOT NULL,
    "unitsPerCarton" INTEGER,
    "cartonCbm" REAL,
    "cartonKg" REAL,
    "freightGoodsType" TEXT,
    "leadTimeDays" INTEGER,
    "mappingConfidence" TEXT NOT NULL,
    "mappingConfirmedByPersonId" TEXT,
    "mappingConfirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierCostLine_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "SupplierCostSheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierCostLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupplierCostSheet_tenantId_code_key" ON "SupplierCostSheet"("tenantId", "code");
CREATE UNIQUE INDEX "SupplierCostSheet_businessId_sourceSha256_key" ON "SupplierCostSheet"("businessId", "sourceSha256");
CREATE INDEX "SupplierCostSheet_businessId_status_createdAt_idx" ON "SupplierCostSheet"("businessId", "status", "createdAt");
CREATE INDEX "SupplierCostSheet_supplierId_status_idx" ON "SupplierCostSheet"("supplierId", "status");
CREATE UNIQUE INDEX "SupplierCostLine_sheetId_sourceSku_minQty_key" ON "SupplierCostLine"("sheetId", "sourceSku", "minQty");
CREATE INDEX "SupplierCostLine_productId_minQty_idx" ON "SupplierCostLine"("productId", "minQty");
