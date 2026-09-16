-- @req FR-174 — WarehouseLocation (nine supply-chain buckets from a Chinese
-- factory to a customer's lobby, `isVirtual` for the places the Business does
-- not hold) and the two location columns that make StockMovement a LOCATED
-- ledger. Both columns are nullable, so every row already written stays valid
-- and every existing reader keeps returning the same number.
-- @req FR-175 — StockMovement."costSatang": the UNIT landed cost of that row in
-- satang (THB × 100). Integer money, the ADR-065 D2 rule.
-- @req FR-176 — CustomizationWorkOrder, and the three Product columns that let
-- branded output be refused: `itemKind`, `dedicatedCustomerId`,
-- `dedicatedSalesOrderId`.
-- @req FR-177 — KittingWorkOrder, ProductRecipe."scrapAllowanceFactor" and
-- Product."flowAccountSku" (unique per Tenant), the accounting system's code
-- for a tradeable set.
-- @req FR-179 — Product."maintenanceIntervalDays" / "maxStorageDays" and
-- ProductLot."lastMaintainedAt": storage ageing, guarded on issue.
-- @req FR-180 — StockReservation: the two-tier promise ATP subtracts.
-- @spec ADR-074; BR-026, BR-027, BR-028, BR-029, BR-030, BR-031, BR-032;
--   BR-002; SEC-001
-- @tested tests/integration/fr174-warehouse-locations.test.js,
--   tests/integration/fr176-customization-work-order.test.js,
--   tests/integration/fr177-kitting-work-order.test.js,
--   tests/integration/fr178-de-kitting.test.js,
--   tests/integration/fr179-shelf-life-guard.test.js,
--   tests/integration/fr180-atp-reservations.test.js
--
-- Additive only: four new tables with their indexes, foreign keys, forced RLS
-- and the same private-application-table grant shape every table in this
-- schema carries (20260906233000_inventory_recipe.sql is the pattern), plus
-- sixteen columns added to four existing tables. Every added column is
-- nullable or carries a default, so no existing row needs a backfill and no
-- existing reader changes. Nothing is altered, renamed, dropped or rewritten.
-- Idempotent: safe to run more than once. Timestamp chosen after checking the
-- directory for a collision (tests/unit/migration-version-uniqueness.test.js
-- guards it).
--
-- `type`, `status`, `technique` and `purpose` are TEXT rather than native
-- enums and carry no CHECK constraint, following this schema's stated
-- convention (enums.js is the single source of truth: "enums are strings in
-- the database"). A CHECK here would be a second vocabulary to keep in step
-- with the first.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

-- ── FR-174 locations ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WarehouseLocation" (
  "id"         TEXT PRIMARY KEY,
  "code"       TEXT NOT NULL,
  "tenantId"   TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"       TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "isVirtual"  BOOLEAN NOT NULL DEFAULT false,
  "address"    TEXT,
  "status"     TEXT NOT NULL DEFAULT 'ACTIVE',
  "archivedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"    INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseLocation_tenantId_code_key" ON "WarehouseLocation"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "WarehouseLocation_businessId_type_idx" ON "WarehouseLocation"("businessId", "type");
CREATE INDEX IF NOT EXISTS "WarehouseLocation_businessId_status_idx" ON "WarehouseLocation"("businessId", "status");

-- ── FR-176 customization work orders ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CustomizationWorkOrder" (
  "id"                   TEXT PRIMARY KEY,
  "code"                 TEXT NOT NULL,
  "tenantId"             TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"           TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "salesOrderId"         TEXT,
  "customerId"           TEXT,
  "rawProductId"         TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "outputProductId"      TEXT REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "technique"            TEXT NOT NULL,
  "logoArtworkUrl"       TEXT,
  "pantoneColorsJson"    TEXT,
  "plannedQty"           INTEGER NOT NULL,
  "issuedQty"            INTEGER NOT NULL DEFAULT 0,
  "completedQty"         INTEGER NOT NULL DEFAULT 0,
  "scrapQty"             INTEGER NOT NULL DEFAULT 0,
  "scrapAllowanceFactor" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
  "setupCostSatang"      INTEGER NOT NULL DEFAULT 0,
  "runCostSatang"        INTEGER NOT NULL DEFAULT 0,
  "status"               TEXT NOT NULL DEFAULT 'DRAFT',
  "wipLocationId"        TEXT,
  "scrapLocationId"      TEXT,
  "sourceLocationId"     TEXT,
  "scheduledDate"        TIMESTAMP(3),
  "startedAt"            TIMESTAMP(3),
  "completedAt"          TIMESTAMP(3),
  "cancelledAt"          TIMESTAMP(3),
  "notes"                TEXT,
  "createdByPersonId"    TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"              INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomizationWorkOrder_tenantId_code_key" ON "CustomizationWorkOrder"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "CustomizationWorkOrder_businessId_status_idx" ON "CustomizationWorkOrder"("businessId", "status");
CREATE INDEX IF NOT EXISTS "CustomizationWorkOrder_salesOrderId_idx" ON "CustomizationWorkOrder"("salesOrderId");
CREATE INDEX IF NOT EXISTS "CustomizationWorkOrder_customerId_idx" ON "CustomizationWorkOrder"("customerId");

-- ── FR-177 kitting work orders ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "KittingWorkOrder" (
  "id"                TEXT PRIMARY KEY,
  "code"              TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"        TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "salesOrderId"      TEXT,
  "customerId"        TEXT,
  "recipeId"          TEXT NOT NULL REFERENCES "ProductRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "finishedProductId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "plannedQty"        INTEGER NOT NULL,
  "assembledQty"      INTEGER NOT NULL DEFAULT 0,
  "scrapQty"          INTEGER NOT NULL DEFAULT 0,
  "laborCostSatang"   INTEGER NOT NULL DEFAULT 0,
  "unitCostSatang"    INTEGER,
  "plannedLinesJson"  TEXT,
  "status"            TEXT NOT NULL DEFAULT 'DRAFT',
  "sourceLocationId"  TEXT,
  "wipLocationId"     TEXT,
  "targetLocationId"  TEXT,
  "scrapLocationId"   TEXT,
  "outputLotCode"     TEXT,
  "startedAt"         TIMESTAMP(3),
  "completedAt"       TIMESTAMP(3),
  "cancelledAt"       TIMESTAMP(3),
  "notes"             TEXT,
  "createdByPersonId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "KittingWorkOrder_tenantId_code_key" ON "KittingWorkOrder"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "KittingWorkOrder_businessId_status_idx" ON "KittingWorkOrder"("businessId", "status");
CREATE INDEX IF NOT EXISTS "KittingWorkOrder_salesOrderId_idx" ON "KittingWorkOrder"("salesOrderId");
CREATE INDEX IF NOT EXISTS "KittingWorkOrder_recipeId_idx" ON "KittingWorkOrder"("recipeId");

-- ── FR-180 reservations ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "StockReservation" (
  "id"                TEXT PRIMARY KEY,
  "code"              TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"        TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId"         TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "purpose"           TEXT NOT NULL,
  "quantity"          INTEGER NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'ACTIVE',
  "customerId"        TEXT,
  "salesOrderId"      TEXT,
  "quoteReference"    TEXT,
  "customerCompany"   TEXT,
  "contactHandle"     TEXT,
  "notes"             TEXT,
  "reservedAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  "expiresAt"         TIMESTAMP(3),
  "releasedAt"        TIMESTAMP(3),
  "convertedAt"       TIMESTAMP(3),
  "createdByPersonId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "StockReservation_tenantId_code_key" ON "StockReservation"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "StockReservation_businessId_status_idx" ON "StockReservation"("businessId", "status");
CREATE INDEX IF NOT EXISTS "StockReservation_productId_status_idx" ON "StockReservation"("productId", "status");
CREATE INDEX IF NOT EXISTS "StockReservation_expiresAt_idx" ON "StockReservation"("expiresAt");
CREATE INDEX IF NOT EXISTS "StockReservation_salesOrderId_idx" ON "StockReservation"("salesOrderId");

-- ── Additive columns on existing tables ─────────────────────────────────────

ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "sourceLocationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "targetLocationId" TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "costSatang"       INTEGER;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "customerId"       TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "salesOrderId"     TEXT;
ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "workOrderId"      TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_sourceLocationId_fkey'
  ) THEN
    ALTER TABLE "StockMovement"
      ADD CONSTRAINT "StockMovement_sourceLocationId_fkey"
      FOREIGN KEY ("sourceLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_targetLocationId_fkey'
  ) THEN
    ALTER TABLE "StockMovement"
      ADD CONSTRAINT "StockMovement_targetLocationId_fkey"
      FOREIGN KEY ("targetLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "StockMovement_sourceLocationId_idx" ON "StockMovement"("sourceLocationId");
CREATE INDEX IF NOT EXISTS "StockMovement_targetLocationId_idx" ON "StockMovement"("targetLocationId");
CREATE INDEX IF NOT EXISTS "StockMovement_workOrderId_idx"      ON "StockMovement"("workOrderId");
CREATE INDEX IF NOT EXISTS "StockMovement_salesOrderId_idx"     ON "StockMovement"("salesOrderId");

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "itemKind"                TEXT NOT NULL DEFAULT 'RAW_COMPONENT';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "dedicatedCustomerId"     TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "dedicatedSalesOrderId"   TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maintenanceIntervalDays" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxStorageDays"          INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "flowAccountSku"          TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Product_tenantId_flowAccountSku_key" ON "Product"("tenantId", "flowAccountSku");

ALTER TABLE "ProductLot" ADD COLUMN IF NOT EXISTS "lastMaintainedAt" TIMESTAMP(3);

ALTER TABLE "ProductRecipe" ADD COLUMN IF NOT EXISTS "scrapAllowanceFactor" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ── RLS and grants — private application tables ─────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['WarehouseLocation', 'CustomizationWorkOrder', 'KittingWorkOrder', 'StockReservation'] LOOP
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

COMMENT ON TABLE "WarehouseLocation" IS
  'FR-174 — a place stock can be, typed by what kind of place it is (CN_FACTORY, INTL_SEA_TRANSIT, TH_PORT_CUSTOMS, TH_CENTRAL_RAW, TH_WIP_CUSTOMIZATION, TH_WIP_ASSEMBLY, TH_FINISHED_GOODS, TH_QUARANTINE_SCRAP, CUSTOMER_SITE). isVirtual marks a place the Business does not hold: a partner factory, a container at sea. code is an attribute unique per Tenant, never a key (BR-002).';
COMMENT ON TABLE "CustomizationWorkOrder" IS
  'FR-176 — branded work in progress: one raw SKU, one technique, one customer, one sales order. Completing it receives a CUSTOM_COMPONENT dedicated to that customer; the raw SKU never comes back (BR-028). Holds intent and progress only — quantities on hand are still the sum of StockMovement.';
COMMENT ON TABLE "KittingWorkOrder" IS
  'FR-177 — assembly of one FINISHED_SET from one ProductRecipe, issuing ceil(net x (1 + scrapAllowanceFactor)) of each component (BR-029) and receiving the set at the finished-goods location with a blended landed unit cost (FR-175).';
COMMENT ON TABLE "StockReservation" IS
  'FR-180 — what is already promised: QUOTE (soft, expiring, 7 days by default) or ORDER (committed). ATP = onHand - committed - live quote reservations. Never writes the stock ledger and is never deleted: it ends RELEASED, CONVERTED or EXPIRED (BR-031).';

COMMENT ON COLUMN "StockMovement"."costSatang" IS
  'FR-175 — the UNIT landed cost of this movement in satang (THB x 100), never a float and never a line total: factory cost + amortised sea freight, duty and the flat single-drop inbound truck, plus any customization and kitting cost added downstream (BR-027).';
COMMENT ON COLUMN "Product"."itemKind" IS
  'FR-176 — the role this SKU plays in a kit: RAW_COMPONENT, PACKAGING_MATERIAL, CUSTOM_COMPONENT or FINISHED_SET. Distinct from stockPolicy (the nature, FR-168) and trackingMode (how units are identified). CUSTOM_COMPONENT is the one that is refusable: with dedicatedCustomerId / dedicatedSalesOrderId set, it may never be issued for anyone else (BR-028).';
COMMENT ON COLUMN "Product"."flowAccountSku" IS
  'FR-177 — the accounting system''s item code for a tradeable finished set, [MODEL]-[COUNT]([PACKAGE]) e.g. TMS06-4(P-16). Unique per Tenant, never a key (BR-002). Not "code", whose FR-154 pattern has no parentheses, and not an ExternalRef row: that table is unique on (system, value) installation-wide, so two Tenants could not both sell a set the same factory model names.';
COMMENT ON COLUMN "Product"."maxStorageDays" IS
  'FR-179 — past this many days from ProductLot.lastMaintainedAt ?? manufacturedAt, a lot is refused for issue and for kitting until a maintenance is recorded. NULL means the product does not age in storage (BR-030).';
COMMENT ON COLUMN "ProductRecipe"."scrapAllowanceFactor" IS
  'FR-177 — the loss this bill of materials expects, a fraction in [0, 0.20]. Gross issue = ceil(net x (1 + factor)). Default 0, so every recipe predating ADR-074 explodes exactly as it did (BR-029).';

COMMIT;
