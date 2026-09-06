-- @req FR-160 — Supplier and PurchaseOrder (with PurchaseOrderLine): the buy
-- side of a Business — an approved supplier (code unique per Tenant, archived
-- never deleted) and an order against it whose lines may name an Inventory SKU
-- at the agreed unit cost in integer satang. Total, received and outstanding
-- quantities are computed on read from the lines and the receipt lines.
-- @req FR-161 — GoodsReceipt and GoodsReceiptLine: what arrived against a SENT
-- order; a line naming a counted SKU posts RECEIPT rows into the Inventory
-- ledger in the same transaction (reference PO:<code>/GRN:<code>). Never edited.
-- @spec ADR-066; ADR-054 D3/D4/D5; BR-001; BR-002; SEC-001
-- @tested tests/integration/fr160-procurement.test.js, tests/integration/fr161-goods-receipt.test.js
--
-- Additive only: five new tables, their indexes, foreign keys, forced RLS and
-- the same private-application-table grant shape every table in this schema
-- carries (20260907000000_commerce_orders_payments.sql is the pattern). Nothing
-- existing is altered, renamed, dropped or rewritten. Idempotent: safe to run
-- more than once. Timestamp chosen after checking the directory for a
-- collision (tests/unit/migration-version-uniqueness.test.js guards it).
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "Supplier" (
  "id"           TEXT PRIMARY KEY,
  "code"         TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"   TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"         TEXT NOT NULL,
  "taxId"        TEXT,
  "contactName"  TEXT,
  "phone"        TEXT,
  "email"        TEXT,
  "address"      TEXT,
  "paymentTerms" TEXT,
  "leadTimeDays" INTEGER,
  "notes"        TEXT,
  "status"       TEXT NOT NULL DEFAULT 'ACTIVE',
  "archivedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"      INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_tenantId_code_key" ON "Supplier"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "Supplier_businessId_status_idx" ON "Supplier"("businessId", "status");

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
  "id"                TEXT PRIMARY KEY,
  "code"              TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"        TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "supplierId"        TEXT NOT NULL REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status"            TEXT NOT NULL DEFAULT 'DRAFT',
  "currency"          TEXT NOT NULL DEFAULT 'THB',
  "expectedAt"        TIMESTAMP(3),
  "notes"             TEXT,
  "orderedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "sentAt"            TIMESTAMP(3),
  "receivedAt"        TIMESTAMP(3),
  "closedAt"          TIMESTAMP(3),
  "closeReason"       TEXT,
  "cancelledAt"       TIMESTAMP(3),
  "cancelReason"      TEXT,
  "createdByPersonId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_tenantId_code_key" ON "PurchaseOrder"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_businessId_status_orderedAt_idx" ON "PurchaseOrder"("businessId", "status", "orderedAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

CREATE TABLE IF NOT EXISTS "PurchaseOrderLine" (
  "id"              TEXT PRIMARY KEY,
  "purchaseOrderId" TEXT NOT NULL REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId"       TEXT REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "description"     TEXT NOT NULL,
  "qty"             INTEGER NOT NULL,
  "unitCostSatang"  INTEGER NOT NULL,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_productId_idx" ON "PurchaseOrderLine"("productId");

CREATE TABLE IF NOT EXISTS "GoodsReceipt" (
  "id"                TEXT PRIMARY KEY,
  "code"              TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"        TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "purchaseOrderId"   TEXT NOT NULL REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "supplierReference" TEXT,
  "notes"             TEXT,
  "receivedAt"        TIMESTAMP(3) NOT NULL DEFAULT now(),
  "postedByPersonId"  TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "GoodsReceipt_tenantId_code_key" ON "GoodsReceipt"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "GoodsReceipt_businessId_receivedAt_idx" ON "GoodsReceipt"("businessId", "receivedAt");

CREATE TABLE IF NOT EXISTS "GoodsReceiptLine" (
  "id"                  TEXT PRIMARY KEY,
  "receiptId"           TEXT NOT NULL REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "purchaseOrderLineId" TEXT NOT NULL REFERENCES "PurchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "qty"                 INTEGER NOT NULL,
  "lotCode"             TEXT,
  "expiresAt"           TIMESTAMP(3),
  "serialNosJson"       TEXT
);
CREATE INDEX IF NOT EXISTS "GoodsReceiptLine_receiptId_idx" ON "GoodsReceiptLine"("receiptId");
CREATE INDEX IF NOT EXISTS "GoodsReceiptLine_purchaseOrderLineId_idx" ON "GoodsReceiptLine"("purchaseOrderLineId");

-- ── RLS and grants — private application tables ─────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['Supplier', 'PurchaseOrder', 'PurchaseOrderLine', 'GoodsReceipt', 'GoodsReceiptLine'] LOOP
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

COMMENT ON TABLE "Supplier" IS 'FR-160 — an approved supplier of a Business (procurement); code unique per Tenant is an attribute (BR-002); archived, never deleted.';
COMMENT ON TABLE "PurchaseOrder" IS 'FR-160 — a purchase order against a Supplier (PO-YYYYMMDD-NNN); DRAFT → SENT → RECEIVED, CLOSED (short-close), CANCELLED; total and received quantities computed on read (ADR-066).';
COMMENT ON TABLE "PurchaseOrderLine" IS 'FR-160 — one line of a purchase order; may name an Inventory SKU; qty × unitCostSatang.';
COMMENT ON TABLE "GoodsReceipt" IS 'FR-161 — a goods receipt (GRN-YYYYMMDD-NNN) posted against a SENT purchase order; the stock effect is the Inventory ledger rows with reference PO:<code>/GRN:<code>; never edited.';
COMMENT ON TABLE "GoodsReceiptLine" IS 'FR-161 — one received line against one purchase-order line: qty, optional lot code and expiry, optional serials as a JSON array.';

COMMIT;
