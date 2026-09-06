-- @req FR-156 — Inventory recipe / bill of materials: ProductRecipe (recipe_id —
-- the BOM of one output SKU at one batch size; "for 10 seats" and "for 20
-- seats" are two rows, as a gift box has a BOM at 10 / 50 / 100 / 500 sets)
-- and ProductRecipeLine (a component SKU with its quantity per batch; a
-- `fixed` line does not scale with the quantity built).
-- @spec BR-002; SEC-001
-- @tested tests/integration/fr156-inventory-recipe.test.js
--
-- Additive only: two new tables, their indexes, foreign keys, forced RLS and
-- the same private-application-table grant shape every table in this schema
-- carries (20260906230000_inventory_domain.sql is the pattern). Nothing
-- existing is altered, renamed, dropped or rewritten. Idempotent: safe to run
-- more than once. Timestamp chosen after checking the directory for a
-- collision (tests/unit/migration-version-uniqueness.test.js guards it).
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "ProductRecipe" (
  "id"         TEXT PRIMARY KEY,
  "code"       TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId"  TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"       TEXT NOT NULL,
  "batchSize"  INTEGER NOT NULL,
  "yieldQty"   INTEGER NOT NULL,
  "unit"       TEXT NOT NULL DEFAULT 'EA',
  "notes"      TEXT,
  "status"     TEXT NOT NULL DEFAULT 'ACTIVE',
  "archivedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"    INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductRecipe_tenantId_code_key" ON "ProductRecipe"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductRecipe_productId_batchSize_key" ON "ProductRecipe"("productId", "batchSize");
CREATE INDEX IF NOT EXISTS "ProductRecipe_businessId_status_idx" ON "ProductRecipe"("businessId", "status");

CREATE TABLE IF NOT EXISTS "ProductRecipeLine" (
  "id"                 TEXT PRIMARY KEY,
  "recipeId"           TEXT NOT NULL REFERENCES "ProductRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "componentProductId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "qty"                DOUBLE PRECISION NOT NULL,
  "unit"               TEXT,
  "fixed"              BOOLEAN NOT NULL DEFAULT false,
  "note"               TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductRecipeLine_recipeId_componentProductId_key" ON "ProductRecipeLine"("recipeId", "componentProductId");
CREATE INDEX IF NOT EXISTS "ProductRecipeLine_componentProductId_idx" ON "ProductRecipeLine"("componentProductId");

-- ── RLS and grants — private application tables ─────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ProductRecipe', 'ProductRecipeLine'] LOOP
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

COMMENT ON TABLE "ProductRecipe" IS 'FR-156 — recipe / bill of materials (recipe_id) of one output SKU at one batchSize; one row per (product, batchSize); yieldQty units come out of one batch.';
COMMENT ON TABLE "ProductRecipeLine" IS 'FR-156 — one component SKU of a recipe with its qty per batch; fixed = does not scale with the quantity built.';

COMMIT;
