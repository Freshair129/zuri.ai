-- CreateTable
CREATE TABLE "LineProductDisclosurePolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lineOaAccountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL,
    "sourceBindingJson" TEXT NOT NULL,
    "projectionSha256" TEXT NOT NULL,
    "skuLookupSha256" TEXT,
    "nameThLookupSha256" TEXT,
    "nameEnLookupSha256" TEXT,
    "approvedByPersonId" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL,
    "reason" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LineProductDisclosurePolicy_businessId_tenantId_fkey"
      FOREIGN KEY ("businessId", "tenantId") REFERENCES "Business" ("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineProductDisclosurePolicy_lineOaAccountId_tenantId_businessId_fkey"
      FOREIGN KEY ("lineOaAccountId", "tenantId", "businessId") REFERENCES "LineOaAccount" ("id", "tenantId", "businessId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineProductDisclosurePolicy_productId_tenantId_businessId_fkey"
      FOREIGN KEY ("productId", "tenantId", "businessId") REFERENCES "Product" ("id", "tenantId", "businessId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LineProductDisclosurePolicy_scope_product_key"
  ON "LineProductDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "productId");

-- CreateIndex
CREATE INDEX "LineProductDisclosurePolicy_scope_account_idx"
  ON "LineProductDisclosurePolicy"("businessId", "lineOaAccountId");

-- CreateIndex
CREATE INDEX "LineProductDisclosurePolicy_sku_lookup_idx"
  ON "LineProductDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "skuLookupSha256");

-- CreateIndex
CREATE INDEX "LineProductDisclosurePolicy_name_th_lookup_idx"
  ON "LineProductDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "nameThLookupSha256");

-- CreateIndex
CREATE INDEX "LineProductDisclosurePolicy_name_en_lookup_idx"
  ON "LineProductDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "nameEnLookupSha256");
