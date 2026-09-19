-- @req FR-201 — ProductMaster."nature" (GOOD | SERVICE) and
-- "defaultStockPolicy": the nature is declared once at the master and every
-- SKU inherits it (BR-038). Existing masters are backfilled from their own
-- SKUs: a master whose SKUs are all SERVICE becomes SERVICE, every other
-- master is GOOD. A SERVICE SKU left under a GOOD master by that rule keeps
-- working (every ledger rule reads the SKU) and is reported by the hygiene
-- report until the Business moves it.
-- @req FR-202 — ProductMaster."variantAxesJson", Product."variantJson" and
-- Product."variantKey" with the NULL-tolerant unique index that makes one
-- physical variant one SKU (BR-039). Every existing row keeps a NULL key, and
-- PostgreSQL treats NULLs as distinct in a unique index, so nothing existing
-- can collide.
-- @req FR-203 — ProductIdentifier: a barcode, GTIN, supplier code,
-- manufacturer part or legacy code as an attribute of exactly one SKU, unique
-- per Tenant per kind, never a key (BR-002), never an ExternalRef.
-- @req FR-204 — ProductUnitConversion: a pack size as an integer factor on
-- the SKU, never a second SKU (BR-037); the ledger counts base units only.
-- @req FR-205 — Product."mergedIntoProductId": the survivor of a MERGE. Not a
-- foreign key on purpose: the chain is walked, not joined.
-- @req FR-207 — Product."reorderPoint", "reorderQty", "leadTimeDays".
-- @spec ADR-083 D1..D6; BR-002, BR-037, BR-038, BR-039, BR-040; SEC-001
--
-- Additive and idempotent. This migration is a release artifact and is
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057), dry run first.

BEGIN;

ALTER TABLE "ProductMaster" ADD COLUMN IF NOT EXISTS "nature"             TEXT NOT NULL DEFAULT 'GOOD';
ALTER TABLE "ProductMaster" ADD COLUMN IF NOT EXISTS "defaultStockPolicy" TEXT NOT NULL DEFAULT 'TRACKED';
ALTER TABLE "ProductMaster" ADD COLUMN IF NOT EXISTS "variantAxesJson"    TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variantJson"         TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variantKey"          TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "mergedIntoProductId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reorderPoint"        INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reorderQty"          INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "leadTimeDays"        INTEGER;

-- Backfill the nature from the SKUs a master already has. Idempotent: a
-- second run finds the same masters already SERVICE and changes nothing.
UPDATE "ProductMaster" pm
SET "nature" = 'SERVICE', "defaultStockPolicy" = 'SERVICE'
WHERE pm."nature" <> 'SERVICE'
  AND EXISTS (SELECT 1 FROM "Product" p WHERE p."productMasterId" = pm."id")
  AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."productMasterId" = pm."id" AND p."stockPolicy" <> 'SERVICE');

CREATE TABLE IF NOT EXISTS "ProductIdentifier" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "issuer" TEXT,
  "unit" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "ProductUnitConversion" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "unit" TEXT NOT NULL,
  "name" TEXT,
  "factor" INTEGER NOT NULL,
  "usage" TEXT NOT NULL DEFAULT 'ANY',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "Product_productMasterId_variantKey_key" ON "Product"("productMasterId", "variantKey");
CREATE INDEX IF NOT EXISTS "Product_mergedIntoProductId_idx" ON "Product"("mergedIntoProductId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductIdentifier_tenantId_kind_value_key" ON "ProductIdentifier"("tenantId", "kind", "value");
CREATE INDEX IF NOT EXISTS "ProductIdentifier_productId_status_idx" ON "ProductIdentifier"("productId", "status");
CREATE INDEX IF NOT EXISTS "ProductIdentifier_businessId_value_idx" ON "ProductIdentifier"("businessId", "value");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductUnitConversion_productId_unit_key" ON "ProductUnitConversion"("productId", "unit");
CREATE INDEX IF NOT EXISTS "ProductUnitConversion_businessId_status_idx" ON "ProductUnitConversion"("businessId", "status");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ProductIdentifier', 'ProductUnitConversion'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format('CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I FROM public, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO zuri_app_runtime, zuri_web_login', t);
  END LOOP;
END $$;

COMMENT ON COLUMN "ProductMaster"."nature" IS 'FR-201 — GOOD | SERVICE, fixed at creation. A GOOD master''s SKUs are TRACKED or UNTRACKED; a SERVICE master''s SKUs are SERVICE. A service is never a variant of a good (BR-038).';
COMMENT ON COLUMN "ProductMaster"."defaultStockPolicy" IS 'FR-201 — the stockPolicy a SKU under a GOOD master takes when the request names none (TRACKED | UNTRACKED); SERVICE on a SERVICE master.';
COMMENT ON COLUMN "ProductMaster"."variantAxesJson" IS 'FR-202 — JSON array of the axes that distinguish this master''s SKUs, e.g. ["color","size"]. Empty means no variant identity is declared.';
COMMENT ON COLUMN "Product"."variantJson" IS 'FR-202 — JSON map of this SKU''s value on each axis its master declares.';
COMMENT ON COLUMN "Product"."variantKey" IS 'FR-202 — normalized axis=value|axis=value fingerprint, unique per master (BR-039); NULL when the master declares no axes.';
COMMENT ON COLUMN "Product"."mergedIntoProductId" IS 'FR-205 — the survivor this archived duplicate was merged into; its ledger rows stay. Walked, not joined.';
COMMENT ON COLUMN "Product"."reorderPoint" IS 'FR-207 — below this on-hand a counted ACTIVE SKU is suggested for replenishment; NULL means use safetyStock.';
COMMENT ON COLUMN "Product"."reorderQty" IS 'FR-207 — the quantity to suggest; NULL means the gap back to the threshold.';
COMMENT ON COLUMN "Product"."leadTimeDays" IS 'FR-207 — the supplier lead time echoed with the suggestion.';
COMMENT ON COLUMN "Product"."status" IS 'FR-154, FR-205 — ACTIVE | PHASE_OUT (receipts refused, sell-down continues) | ARCHIVED (never deleted; refused while stock or a live reservation remains, BR-040).';
COMMENT ON TABLE "ProductIdentifier" IS 'FR-203 — a barcode (GTIN | BARCODE), SUPPLIER_CODE, MANUFACTURER_PART or LEGACY_CODE of one SKU; unique per (tenantId, kind, value), the two scannable kinds sharing one value space in the service; unit names the pack the barcode is on; RETIRED keeps the row. Never a key (BR-002).';
COMMENT ON TABLE "ProductUnitConversion" IS 'FR-204 — one unit of this row is factor base units of the SKU (BR-037); usage PURCHASE | SALES | ANY; unique per (productId, unit); RETIRED keeps the row.';

COMMIT;
