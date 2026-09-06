-- @req FR-156 — ProductRecipe and ProductRecipeLine: the bill of materials of
-- one output SKU at one batch size. Twin of
-- supabase/migrations/20260906233000_inventory_recipe.sql.
-- @spec BR-002 (codes are attributes, never keys); SEC-001
-- Additive: two new tables, their indexes and foreign keys; nothing existing changes.

-- CreateTable
CREATE TABLE "ProductRecipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "batchSize" INTEGER NOT NULL,
    "yieldQty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ProductRecipe_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductRecipe_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductRecipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductRecipeLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "unit" TEXT,
    "fixed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    CONSTRAINT "ProductRecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductRecipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductRecipeLine_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipe_tenantId_code_key" ON "ProductRecipe"("tenantId", "code");
CREATE UNIQUE INDEX "ProductRecipe_productId_batchSize_key" ON "ProductRecipe"("productId", "batchSize");
CREATE INDEX "ProductRecipe_businessId_status_idx" ON "ProductRecipe"("businessId", "status");
CREATE UNIQUE INDEX "ProductRecipeLine_recipeId_componentProductId_key" ON "ProductRecipeLine"("recipeId", "componentProductId");
CREATE INDEX "ProductRecipeLine_componentProductId_idx" ON "ProductRecipeLine"("componentProductId");
