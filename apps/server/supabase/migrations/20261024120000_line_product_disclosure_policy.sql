CREATE TABLE "LineProductDisclosurePolicy" (
    "id" TEXT NOT NULL,
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
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LineProductDisclosurePolicy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LineProductDisclosurePolicy_businessId_tenantId_fkey"
      FOREIGN KEY ("businessId", "tenantId") REFERENCES "Business"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineProductDisclosurePolicy_lineOaAccountId_tenantId_busin_fkey"
      FOREIGN KEY ("lineOaAccountId", "tenantId", "businessId") REFERENCES "LineOaAccount"("id", "tenantId", "businessId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineProductDisclosurePolicy_productId_tenantId_businessId_fkey"
      FOREIGN KEY ("productId", "tenantId", "businessId") REFERENCES "Product"("id", "tenantId", "businessId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LineProductDisclosurePolicy_scope_product_key"
  ON "LineProductDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "productId");
CREATE INDEX "LineProductDisclosurePolicy_scope_account_idx"
  ON "LineProductDisclosurePolicy"("businessId", "lineOaAccountId");
CREATE INDEX "LineProductDisclosurePolicy_sku_lookup_idx"
  ON "LineProductDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "skuLookupSha256");
CREATE INDEX "LineProductDisclosurePolicy_name_th_lookup_idx"
  ON "LineProductDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "nameThLookupSha256");
CREATE INDEX "LineProductDisclosurePolicy_name_en_lookup_idx"
  ON "LineProductDisclosurePolicy"("tenantId", "businessId", "lineOaAccountId", "nameEnLookupSha256");

-- Private application policy rows contain owner-approved customer-facing facts
-- and normalized lookup hashes. Runtime access remains behind the application
-- role and the existing Business/account/product scope checks.
ALTER TABLE "LineProductDisclosurePolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineProductDisclosurePolicy" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineProductDisclosurePolicy' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "LineProductDisclosurePolicy" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "LineProductDisclosurePolicy" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "LineProductDisclosurePolicy" TO zuri_app_runtime, zuri_web_login;
