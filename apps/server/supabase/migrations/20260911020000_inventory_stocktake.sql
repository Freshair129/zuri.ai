-- @req FR-184 — durable NONE/LOT stocktake observations and the shared
-- Inventory ledger fence. This additive migration is a release artifact; it is
-- not applied to production by this change.
-- @spec ADR-074 D1, D2; BR-002, BR-008, BR-012, BR-026; SEC-001

BEGIN;

CREATE TABLE IF NOT EXISTS "InventoryLedgerFence" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "mutationRevision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "InventoryStocktake" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "normalizedLinesJson" TEXT NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
  "resultJson" TEXT,
  "committedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLedgerFence_tenantId_businessId_key" ON "InventoryLedgerFence"("tenantId", "businessId");
CREATE INDEX IF NOT EXISTS "InventoryLedgerFence_businessId_idx" ON "InventoryLedgerFence"("businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryStocktake_tenantId_businessId_idempotencyKey_key" ON "InventoryStocktake"("tenantId", "businessId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "InventoryStocktake_businessId_status_createdAt_idx" ON "InventoryStocktake"("businessId", "status", "createdAt");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['InventoryLedgerFence', 'InventoryStocktake'] LOOP
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

COMMENT ON TABLE "InventoryLedgerFence" IS 'FR-184 — lock-only Business-scoped revision for serializing inventory reads and writes.';
COMMENT ON TABLE "InventoryStocktake" IS 'FR-184 — durable NONE/LOT physical count preview and atomic commit result.';

COMMIT;
