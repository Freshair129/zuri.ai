-- @req FR-201 — ProductMaster."nature" (GOOD | SERVICE) and
-- "defaultStockPolicy": the nature is declared once at the master and every
-- SKU inherits it (BR-038). Existing masters are backfilled from their own
-- SKUs: all-SERVICE becomes SERVICE, everything else GOOD.
-- @req FR-202 — ProductMaster."variantAxesJson", Product."variantJson" and
-- Product."variantKey" with the NULL-tolerant unique index that makes one
-- physical variant one SKU (BR-039). Every existing row keeps a NULL key.
-- @req FR-203 — ProductIdentifier: barcode, GTIN, supplier and manufacturer
-- codes as attributes of one SKU, unique per Tenant per kind (BR-002).
-- @req FR-204 — ProductUnitConversion: a pack size as an integer factor on
-- the SKU, never a second SKU (BR-037).
-- @req FR-205 — Product."mergedIntoProductId": the survivor of a MERGE.
-- @req FR-207 — Product."reorderPoint", "reorderQty", "leadTimeDays".
-- @spec ADR-083 D1..D6; BR-002, BR-037, BR-038, BR-039, BR-040
-- Additive. This is the local twin of supabase/migrations/20260913120000_inventory_sku_governance.sql.

-- AlterTable
ALTER TABLE "ProductMaster" ADD COLUMN "nature" TEXT NOT NULL DEFAULT 'GOOD';
ALTER TABLE "ProductMaster" ADD COLUMN "defaultStockPolicy" TEXT NOT NULL DEFAULT 'TRACKED';
ALTER TABLE "ProductMaster" ADD COLUMN "variantAxesJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "variantJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Product" ADD COLUMN "variantKey" TEXT;
ALTER TABLE "Product" ADD COLUMN "mergedIntoProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN "reorderPoint" INTEGER;
ALTER TABLE "Product" ADD COLUMN "reorderQty" INTEGER;
ALTER TABLE "Product" ADD COLUMN "leadTimeDays" INTEGER;

-- Backfill the nature from the SKUs a master already has (idempotent).
UPDATE "ProductMaster"
SET "nature" = 'SERVICE', "defaultStockPolicy" = 'SERVICE'
WHERE EXISTS (SELECT 1 FROM "Product" p WHERE p."productMasterId" = "ProductMaster"."id")
  AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."productMasterId" = "ProductMaster"."id" AND p."stockPolicy" <> 'SERVICE');

-- CreateTable
CREATE TABLE "ProductIdentifier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "issuer" TEXT,
    "unit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProductIdentifier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductIdentifier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductIdentifier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductUnitConversion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "name" TEXT,
    "factor" INTEGER NOT NULL,
    "usage" TEXT NOT NULL DEFAULT 'ANY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProductUnitConversion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductUnitConversion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductUnitConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_productMasterId_variantKey_key" ON "Product"("productMasterId", "variantKey");
CREATE INDEX "Product_mergedIntoProductId_idx" ON "Product"("mergedIntoProductId");
CREATE UNIQUE INDEX "ProductIdentifier_tenantId_kind_value_key" ON "ProductIdentifier"("tenantId", "kind", "value");
CREATE INDEX "ProductIdentifier_productId_status_idx" ON "ProductIdentifier"("productId", "status");
CREATE INDEX "ProductIdentifier_businessId_value_idx" ON "ProductIdentifier"("businessId", "value");
CREATE UNIQUE INDEX "ProductUnitConversion_productId_unit_key" ON "ProductUnitConversion"("productId", "unit");
CREATE INDEX "ProductUnitConversion_businessId_status_idx" ON "ProductUnitConversion"("businessId", "status");
