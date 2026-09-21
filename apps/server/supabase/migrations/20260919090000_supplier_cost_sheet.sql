-- @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
-- SupplierCostSheet stores one source snapshot, its locked FX and preview until
-- every mapping is confirmed by a person. SupplierCostLine is written only by
-- the commit transaction; Product carton facts remain nullable for legacy rows.
--
-- Additive only. This migration is NOT APPLIED to production by this change.
-- Applying it is an owner-instructed operator step: dry-run in a rolled-back
-- transaction, then apply and record the migration version.

BEGIN;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unitsPerCarton" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "cartonCbm" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "cartonKg" DOUBLE PRECISION;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "freightGoodsType" TEXT;

CREATE TABLE IF NOT EXISTS "SupplierCostSheet" (
  "id"                  TEXT PRIMARY KEY,
  "code"                TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"          TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "supplierId"          TEXT NOT NULL REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "currency"            TEXT NOT NULL,
  "fxRateLocked"        DOUBLE PRECISION NOT NULL,
  "sourceRef"           TEXT,
  "sourceSha256"        TEXT NOT NULL,
  "previewHash"         TEXT NOT NULL,
  "previewJson"         TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'DRAFT',
  "lineCount"           INTEGER NOT NULL DEFAULT 0,
  "createdByPersonId"   TEXT,
  "confirmedByPersonId" TEXT,
  "confirmedAt"         TIMESTAMP(3),
  "supersededAt"        TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"             INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "SupplierCostLine" (
  "id"                         TEXT PRIMARY KEY,
  "sheetId"                    TEXT NOT NULL REFERENCES "SupplierCostSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId"                  TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceSku"                  TEXT NOT NULL,
  "minQty"                     INTEGER NOT NULL,
  "unitCostForeign"            DOUBLE PRECISION NOT NULL,
  "unitsPerCarton"             INTEGER,
  "cartonCbm"                  DOUBLE PRECISION,
  "cartonKg"                   DOUBLE PRECISION,
  "freightGoodsType"           TEXT,
  "leadTimeDays"               INTEGER,
  "mappingConfidence"          TEXT NOT NULL,
  "mappingConfirmedByPersonId" TEXT,
  "mappingConfirmedAt"         TIMESTAMP(3),
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"                  TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierCostSheet_tenantId_code_key" ON "SupplierCostSheet"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierCostSheet_businessId_sourceSha256_key" ON "SupplierCostSheet"("businessId", "sourceSha256");
CREATE INDEX IF NOT EXISTS "SupplierCostSheet_businessId_status_createdAt_idx" ON "SupplierCostSheet"("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SupplierCostSheet_supplierId_status_idx" ON "SupplierCostSheet"("supplierId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierCostLine_sheetId_sourceSku_minQty_key" ON "SupplierCostLine"("sheetId", "sourceSku", "minQty");
CREATE INDEX IF NOT EXISTS "SupplierCostLine_productId_minQty_idx" ON "SupplierCostLine"("productId", "minQty");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['SupplierCostSheet', 'SupplierCostLine'] LOOP
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

COMMENT ON TABLE "SupplierCostSheet" IS 'TASK-ZAI-053 — one factory cost source version with locked FX, source hash, preview and human confirmation state; not production-applied by the implementation worker.';
COMMENT ON TABLE "SupplierCostLine" IS 'TASK-ZAI-053 — one confirmed SKU price break; no line exists while mapping is unconfirmed.';
COMMENT ON COLUMN "SupplierCostSheet"."fxRateLocked" IS 'The source version rate used for all derived baht costs; never a spot lookup.';
COMMENT ON COLUMN "Product"."unitsPerCarton" IS 'TASK-ZAI-053 — nullable carton quantity supplied by a confirmed factory cost sheet.';
COMMENT ON COLUMN "Product"."cartonCbm" IS 'TASK-ZAI-053 — nullable cubic metres per carton.';
COMMENT ON COLUMN "Product"."cartonKg" IS 'TASK-ZAI-053 — nullable kilograms per carton.';
COMMENT ON COLUMN "Product"."freightGoodsType" IS 'TASK-ZAI-053 — optional freight goods classification supplied with carton data.';

COMMIT;
