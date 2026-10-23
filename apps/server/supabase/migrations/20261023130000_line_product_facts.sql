-- CreateTable
CREATE TABLE "LineStockDisclosurePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lineOaAccountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "createdByPersonId" TEXT NOT NULL,
    "updatedByPersonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineStockDisclosurePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineStockDisclosurePolicy_businessId_lineOaAccountId_idx" ON "LineStockDisclosurePolicy"("businessId", "lineOaAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LineStockDisclosurePolicy_tenantId_businessId_lineOaAccount_key" ON "LineStockDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaAccount_id_tenantId_businessId_key" ON "LineOaAccount"("id", "tenantId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_tenantId_businessId_key" ON "Product"("id", "tenantId", "businessId");

-- AddForeignKey
ALTER TABLE "LineStockDisclosurePolicy" ADD CONSTRAINT "LineStockDisclosurePolicy_businessId_tenantId_fkey" FOREIGN KEY ("businessId", "tenantId") REFERENCES "Business"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineStockDisclosurePolicy" ADD CONSTRAINT "LineStockDisclosurePolicy_lineOaAccountId_tenantId_busines_fkey" FOREIGN KEY ("lineOaAccountId", "tenantId", "businessId") REFERENCES "LineOaAccount"("id", "tenantId", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineStockDisclosurePolicy" ADD CONSTRAINT "LineStockDisclosurePolicy_productId_tenantId_businessId_fkey" FOREIGN KEY ("productId", "tenantId", "businessId") REFERENCES "Product"("id", "tenantId", "businessId") ON DELETE CASCADE ON UPDATE CASCADE;
