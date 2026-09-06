-- @req FR-166 — SalesOrder and SalesOrderLine: what a Business sold — lines
-- that may name an inventory SKU, an optional Customer and the Conversation the
-- sale came from (chat-first attribution), a status machine, money as integer
-- satang. Totals, paid, balance and payment state are computed on read.
-- @req FR-163 — Payment: a payment or refund against an order, PENDING until a
-- verifier confirms the slip; bankReference is an attribute unique per Tenant
-- (BR-002); the slip image is a FileAsset of the same Business.
-- @spec ADR-065; ADR-054 D3/D4/D5; BR-001; BR-002; SEC-001
-- @tested tests/integration/fr166-sales-order.test.js, tests/integration/fr163-payment.test.js
--
-- Additive only: three new tables, their indexes, foreign keys, forced RLS and
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

CREATE TABLE IF NOT EXISTS "SalesOrder" (
  "id"                TEXT PRIMARY KEY,
  "code"              TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"        TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "customerId"        TEXT REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "conversationId"    TEXT REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "origin"            TEXT NOT NULL DEFAULT 'WALK_IN',
  "status"            TEXT NOT NULL DEFAULT 'DRAFT',
  "currency"          TEXT NOT NULL DEFAULT 'THB',
  "discountSatang"    INTEGER NOT NULL DEFAULT 0,
  "notes"             TEXT,
  "orderedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "confirmedAt"       TIMESTAMP(3),
  "completedAt"       TIMESTAMP(3),
  "cancelledAt"       TIMESTAMP(3),
  "cancelReason"      TEXT,
  "stockIssuedAt"     TIMESTAMP(3),
  "closedByPersonId"  TEXT,
  "createdByPersonId" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"           INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesOrder_tenantId_code_key" ON "SalesOrder"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "SalesOrder_businessId_status_orderedAt_idx" ON "SalesOrder"("businessId", "status", "orderedAt");
CREATE INDEX IF NOT EXISTS "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");
CREATE INDEX IF NOT EXISTS "SalesOrder_conversationId_idx" ON "SalesOrder"("conversationId");

CREATE TABLE IF NOT EXISTS "SalesOrderLine" (
  "id"              TEXT PRIMARY KEY,
  "orderId"         TEXT NOT NULL REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "productId"       TEXT REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "description"     TEXT NOT NULL,
  "qty"             INTEGER NOT NULL,
  "unitPriceSatang" INTEGER NOT NULL,
  "discountSatang"  INTEGER NOT NULL DEFAULT 0,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "SalesOrderLine_orderId_idx" ON "SalesOrderLine"("orderId");
CREATE INDEX IF NOT EXISTS "SalesOrderLine_productId_idx" ON "SalesOrderLine"("productId");

CREATE TABLE IF NOT EXISTS "Payment" (
  "id"                 TEXT PRIMARY KEY,
  "code"               TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"         TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "orderId"            TEXT NOT NULL REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind"               TEXT NOT NULL DEFAULT 'PAYMENT',
  "method"             TEXT NOT NULL,
  "amountSatang"       INTEGER NOT NULL,
  "status"             TEXT NOT NULL DEFAULT 'PENDING',
  "bankReference"      TEXT,
  "slipFileAssetId"    TEXT REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "note"               TEXT,
  "paidAt"             TIMESTAMP(3) NOT NULL DEFAULT now(),
  "verifiedAt"         TIMESTAMP(3),
  "verifiedByPersonId" TEXT,
  "rejectReason"       TEXT,
  "createdByPersonId"  TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"            INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenantId_code_key" ON "Payment"("tenantId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_tenantId_bankReference_key" ON "Payment"("tenantId", "bankReference");
CREATE INDEX IF NOT EXISTS "Payment_orderId_status_idx" ON "Payment"("orderId", "status");
CREATE INDEX IF NOT EXISTS "Payment_businessId_status_paidAt_idx" ON "Payment"("businessId", "status", "paidAt");

-- ── RLS and grants — private application tables ─────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['SalesOrder', 'SalesOrderLine', 'Payment'] LOOP
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

COMMENT ON TABLE "SalesOrder" IS 'FR-166 — a sales order (order_id): Business-scoped, optional Customer/Conversation of the same Tenant, money in satang; totals and payment state computed on read (ADR-065).';
COMMENT ON TABLE "SalesOrderLine" IS 'FR-166 — one line of a sales order; may name an inventory SKU; qty × unitPriceSatang − discountSatang.';
COMMENT ON TABLE "Payment" IS 'FR-163 — a payment or refund against an order, PENDING until verified; bankReference unique per Tenant is an attribute (BR-002); the slip is a FileAsset.';

COMMIT;
