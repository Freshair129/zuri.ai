-- @req FR-154, FR-155 — the Inventory domain (คลังสินค้า): catalogue identity
-- (InventoryCategory, ProductFamily, Factory, ProductMaster, Product,
-- ProductBundle, ProductBundleItem) and the stock ledger (ProductLot, SerialUnit,
-- StockMovement). Twin of supabase/migrations/20260906230000_inventory_domain.sql.
-- @spec BR-002 (codes, serials and lot numbers are attributes, never keys); SEC-001
-- Additive: ten new tables, their indexes and foreign keys; nothing existing changes.

-- CreateTable
CREATE TABLE "InventoryCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "slug" TEXT,
    "vibe" TEXT,
    "targetRecipient" TEXT,
    "guardrail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "InventoryCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryCategory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductFamily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProductFamily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductFamily_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Factory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "contact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Factory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Factory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "familyId" TEXT,
    "factoryId" TEXT,
    "nameTh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "baseCost" REAL NOT NULL DEFAULT 0,
    "specsJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProductMaster_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductMaster_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductMaster_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InventoryCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductMaster_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ProductFamily" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductMaster_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productMasterId" TEXT NOT NULL,
    "name" TEXT,
    "color" TEXT,
    "material" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "stockPolicy" TEXT NOT NULL DEFAULT 'TRACKED',
    "trackingMode" TEXT NOT NULL DEFAULT 'NONE',
    "safetyStock" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "factoryId" TEXT,
    "manufacturedAt" DATETIME,
    "expiresAt" DATETIME,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProductLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductLot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductLot_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SerialUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serialNo" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "SerialUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SerialUnit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SerialUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SerialUnit_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ProductLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductBundle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetRecipients" INTEGER,
    "totalPrice" REAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProductBundle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductBundle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductBundleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProductBundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ProductBundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductBundleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT,
    "serialUnitId" TEXT,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "reference" TEXT,
    "actorId" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ProductLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockMovement_serialUnitId_fkey" FOREIGN KEY ("serialUnitId") REFERENCES "SerialUnit" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCategory_tenantId_code_key" ON "InventoryCategory"("tenantId", "code");
CREATE UNIQUE INDEX "InventoryCategory_businessId_slug_key" ON "InventoryCategory"("businessId", "slug");
CREATE INDEX "InventoryCategory_businessId_status_idx" ON "InventoryCategory"("businessId", "status");
CREATE UNIQUE INDEX "ProductFamily_tenantId_code_key" ON "ProductFamily"("tenantId", "code");
CREATE INDEX "ProductFamily_businessId_status_idx" ON "ProductFamily"("businessId", "status");
CREATE UNIQUE INDEX "Factory_tenantId_code_key" ON "Factory"("tenantId", "code");
CREATE INDEX "Factory_businessId_status_idx" ON "Factory"("businessId", "status");
CREATE UNIQUE INDEX "ProductMaster_tenantId_code_key" ON "ProductMaster"("tenantId", "code");
CREATE INDEX "ProductMaster_businessId_status_idx" ON "ProductMaster"("businessId", "status");
CREATE INDEX "ProductMaster_categoryId_idx" ON "ProductMaster"("categoryId");
CREATE INDEX "ProductMaster_familyId_idx" ON "ProductMaster"("familyId");
CREATE UNIQUE INDEX "Product_tenantId_code_key" ON "Product"("tenantId", "code");
CREATE INDEX "Product_businessId_status_idx" ON "Product"("businessId", "status");
CREATE INDEX "Product_productMasterId_idx" ON "Product"("productMasterId");
CREATE UNIQUE INDEX "ProductLot_productId_code_key" ON "ProductLot"("productId", "code");
CREATE INDEX "ProductLot_businessId_status_idx" ON "ProductLot"("businessId", "status");
CREATE INDEX "ProductLot_factoryId_idx" ON "ProductLot"("factoryId");
CREATE UNIQUE INDEX "SerialUnit_productId_serialNo_key" ON "SerialUnit"("productId", "serialNo");
CREATE INDEX "SerialUnit_businessId_status_idx" ON "SerialUnit"("businessId", "status");
CREATE INDEX "SerialUnit_lotId_idx" ON "SerialUnit"("lotId");
CREATE UNIQUE INDEX "ProductBundle_tenantId_code_key" ON "ProductBundle"("tenantId", "code");
CREATE INDEX "ProductBundle_businessId_status_idx" ON "ProductBundle"("businessId", "status");
CREATE UNIQUE INDEX "ProductBundleItem_bundleId_productId_key" ON "ProductBundleItem"("bundleId", "productId");
CREATE INDEX "ProductBundleItem_productId_idx" ON "ProductBundleItem"("productId");
CREATE INDEX "StockMovement_productId_occurredAt_idx" ON "StockMovement"("productId", "occurredAt");
CREATE INDEX "StockMovement_businessId_occurredAt_idx" ON "StockMovement"("businessId", "occurredAt");
CREATE INDEX "StockMovement_lotId_idx" ON "StockMovement"("lotId");
CREATE INDEX "StockMovement_serialUnitId_idx" ON "StockMovement"("serialUnitId");
