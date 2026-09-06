-- @req FR-154 — Inventory catalogue identity (คลังสินค้า): InventoryCategory,
-- ProductFamily, Factory, ProductMaster, Product (SKU), ProductBundle and
-- ProductBundleItem. Every row is Tenant- and Business-scoped, keyed by an
-- internal UUID with a human `code` unique per Tenant (BR-002).
-- @req FR-155 — the stock ledger: ProductLot, SerialUnit and the append-only
-- StockMovement. On-hand is never stored on the product; it is the sum of the
-- product's movements, recomputed on read.
-- @spec BR-002; SEC-001; ADR-025
-- @tested tests/integration/fr154-inventory-catalog.test.js,
--   tests/integration/fr155-inventory-stock.test.js
--
-- Additive only: ten new tables, their indexes, foreign keys, forced RLS and
-- the same private-application-table grant shape every table in this schema
-- carries (20260906210000_line_oa_liff_app.sql is the pattern). Nothing
-- existing is altered, renamed, dropped or rewritten. Idempotent: safe to run
-- more than once. Timestamp chosen after checking the directory for a
-- collision (tests/unit/migration-version-uniqueness.test.js guards it).
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

-- ── FR-154 catalogue identity ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "InventoryCategory" (
  "id"              TEXT PRIMARY KEY,
  "code"            TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"      TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "nameTh"          TEXT NOT NULL,
  "nameEn"          TEXT NOT NULL,
  "slug"            TEXT,
  "vibe"            TEXT,
  "targetRecipient" TEXT,
  "guardrail"       TEXT,
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCategory_tenantId_code_key" ON "InventoryCategory"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCategory_businessId_slug_key" ON "InventoryCategory"("businessId", "slug");
CREATE INDEX IF NOT EXISTS "InventoryCategory_businessId_status_idx" ON "InventoryCategory"("businessId", "status");

CREATE TABLE IF NOT EXISTS "ProductFamily" (
  "id"          TEXT PRIMARY KEY,
  "code"        TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"  TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"     INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductFamily_tenantId_code_key" ON "ProductFamily"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "ProductFamily_businessId_status_idx" ON "ProductFamily"("businessId", "status");

CREATE TABLE IF NOT EXISTS "Factory" (
  "id"         TEXT PRIMARY KEY,
  "code"       TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"       TEXT NOT NULL,
  "country"    TEXT,
  "contact"    TEXT,
  "status"     TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"    INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "Factory_tenantId_code_key" ON "Factory"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "Factory_businessId_status_idx" ON "Factory"("businessId", "status");

CREATE TABLE IF NOT EXISTS "ProductMaster" (
  "id"         TEXT PRIMARY KEY,
  "code"       TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "categoryId" TEXT NOT NULL REFERENCES "InventoryCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "familyId"   TEXT REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "factoryId"  TEXT REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "nameTh"     TEXT NOT NULL,
  "nameEn"     TEXT NOT NULL,
  "baseCost"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "specsJson"  TEXT NOT NULL DEFAULT '{}',
  "status"     TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"    INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductMaster_tenantId_code_key" ON "ProductMaster"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "ProductMaster_businessId_status_idx" ON "ProductMaster"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ProductMaster_categoryId_idx" ON "ProductMaster"("categoryId");
CREATE INDEX IF NOT EXISTS "ProductMaster_familyId_idx" ON "ProductMaster"("familyId");

CREATE TABLE IF NOT EXISTS "Product" (
  "id"              TEXT PRIMARY KEY,
  "code"            TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"      TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productMasterId" TEXT NOT NULL REFERENCES "ProductMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name"            TEXT,
  "color"           TEXT,
  "material"        TEXT,
  "unit"            TEXT NOT NULL DEFAULT 'EA',
  "stockPolicy"     TEXT NOT NULL DEFAULT 'TRACKED',
  "trackingMode"    TEXT NOT NULL DEFAULT 'NONE',
  "safetyStock"     INTEGER NOT NULL DEFAULT 10,
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
  "archivedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "Product_tenantId_code_key" ON "Product"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "Product_businessId_status_idx" ON "Product"("businessId", "status");
CREATE INDEX IF NOT EXISTS "Product_productMasterId_idx" ON "Product"("productMasterId");

CREATE TABLE IF NOT EXISTS "ProductBundle" (
  "id"               TEXT PRIMARY KEY,
  "code"             TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"       TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "targetRecipients" INTEGER,
  "totalPrice"       DOUBLE PRECISION,
  "status"           TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductBundle_tenantId_code_key" ON "ProductBundle"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "ProductBundle_businessId_status_idx" ON "ProductBundle"("businessId", "status");

CREATE TABLE IF NOT EXISTS "ProductBundleItem" (
  "id"        TEXT PRIMARY KEY,
  "bundleId"  TEXT NOT NULL REFERENCES "ProductBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "qty"       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductBundleItem_bundleId_productId_key" ON "ProductBundleItem"("bundleId", "productId");
CREATE INDEX IF NOT EXISTS "ProductBundleItem_productId_idx" ON "ProductBundleItem"("productId");

-- ── FR-155 stock ledger ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ProductLot" (
  "id"             TEXT PRIMARY KEY,
  "code"           TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"     TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId"      TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "factoryId"      TEXT REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "manufacturedAt" TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  "receivedQty"    INTEGER NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"        INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductLot_productId_code_key" ON "ProductLot"("productId", "code");
CREATE INDEX IF NOT EXISTS "ProductLot_businessId_status_idx" ON "ProductLot"("businessId", "status");
CREATE INDEX IF NOT EXISTS "ProductLot_factoryId_idx" ON "ProductLot"("factoryId");

CREATE TABLE IF NOT EXISTS "SerialUnit" (
  "id"         TEXT PRIMARY KEY,
  "serialNo"   TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId"  TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "lotId"      TEXT REFERENCES "ProductLot"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "status"     TEXT NOT NULL DEFAULT 'IN_STOCK',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"    INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "SerialUnit_productId_serialNo_key" ON "SerialUnit"("productId", "serialNo");
CREATE INDEX IF NOT EXISTS "SerialUnit_businessId_status_idx" ON "SerialUnit"("businessId", "status");
CREATE INDEX IF NOT EXISTS "SerialUnit_lotId_idx" ON "SerialUnit"("lotId");

CREATE TABLE IF NOT EXISTS "StockMovement" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"   TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId"    TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "lotId"        TEXT REFERENCES "ProductLot"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "serialUnitId" TEXT REFERENCES "SerialUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "kind"         TEXT NOT NULL,
  "quantity"     INTEGER NOT NULL,
  "reason"       TEXT,
  "reference"    TEXT,
  "actorId"      TEXT,
  "occurredAt"   TIMESTAMP(3) NOT NULL DEFAULT now(),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "StockMovement_productId_occurredAt_idx" ON "StockMovement"("productId", "occurredAt");
CREATE INDEX IF NOT EXISTS "StockMovement_businessId_occurredAt_idx" ON "StockMovement"("businessId", "occurredAt");
CREATE INDEX IF NOT EXISTS "StockMovement_lotId_idx" ON "StockMovement"("lotId");
CREATE INDEX IF NOT EXISTS "StockMovement_serialUnitId_idx" ON "StockMovement"("serialUnitId");

-- ── RLS and grants — private application tables ─────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'InventoryCategory', 'ProductFamily', 'Factory', 'ProductMaster', 'Product',
    'ProductBundle', 'ProductBundleItem', 'ProductLot', 'SerialUnit', 'StockMovement'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format('CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I FROM public, anon, authenticated, service_role', t);
  END LOOP;
END $$;

COMMENT ON TABLE "InventoryCategory" IS 'FR-154 — inventory category (category_id): Business-scoped catalogue grouping with Thai/English names and an optional slug; no external id is a key (BR-002).';
COMMENT ON TABLE "ProductFamily" IS 'FR-154 — product family (product_family): a Business-scoped grouping of product masters.';
COMMENT ON TABLE "Factory" IS 'FR-154 — factory (factory_id): the manufacturer a product master or lot came from.';
COMMENT ON TABLE "ProductMaster" IS 'FR-154 — product master (product_master): the catalogue item a SKU is a variant of; base cost and specs.';
COMMENT ON TABLE "Product" IS 'FR-154 — product / SKU (product_id): stockPolicy TRACKED or UNTRACKED; trackingMode NONE, LOT or SERIAL; safetyStock. On-hand is not stored here.';
COMMENT ON TABLE "ProductBundle" IS 'FR-154 — bundle (bundle_id): a named pack of SKUs with quantities; availability is derived from the ledger.';
COMMENT ON TABLE "ProductBundleItem" IS 'FR-154 — one SKU line of a bundle.';
COMMENT ON TABLE "ProductLot" IS 'FR-155 — lot (lot_id): a manufacturing batch of one SKU, optionally from a factory, with expiry.';
COMMENT ON TABLE "SerialUnit" IS 'FR-155 — serial unit (serial_id): one physical unit of a serial-tracked SKU and its custody status.';
COMMENT ON TABLE "StockMovement" IS 'FR-155 — append-only stock ledger: RECEIPT, ISSUE or ADJUSTMENT with a signed quantity; on-hand is the sum per product.';

COMMIT;
