-- @req FR-208 — InventoryCatalogIntake: one persisted catalogue intake preview
-- and its committed result (ADR-084 D2). Every surface — JSON, Excel, LINE —
-- converts into one envelope; this row keeps the normalized envelope, the plan
-- the planner made after resolving every item against the catalogue, and the
-- planHash a commit must match. Idempotent on (businessId, sourceChannel,
-- sourceCorrelationId). It holds no catalogue data of its own: the SKUs it
-- creates are written by the catalogue writers and referenced only in JSON.
-- @spec ADR-084 D1, D2; BR-009, BR-041; SDD-009; SEC-001
--
-- Additive and idempotent. This migration is a release artifact and is
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057), dry run first.

BEGIN;

CREATE TABLE IF NOT EXISTS "InventoryCatalogIntake" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceChannel" TEXT NOT NULL,
  "sourceCorrelationId" TEXT NOT NULL,
  "payloadSha256" TEXT NOT NULL,
  "normalizedEnvelopeJson" TEXT NOT NULL,
  "planJson" TEXT NOT NULL,
  "planHash" TEXT NOT NULL,
  "committable" BOOLEAN NOT NULL DEFAULT false,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
  "requestedById" TEXT,
  "resultJson" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "committedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCatalogIntake_businessId_sourceChannel_sourceCorrelationId_key" ON "InventoryCatalogIntake"("businessId", "sourceChannel", "sourceCorrelationId");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCatalogIntake_tenantId_code_key" ON "InventoryCatalogIntake"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "InventoryCatalogIntake_businessId_status_createdAt_idx" ON "InventoryCatalogIntake"("businessId", "status", "createdAt");

ALTER TABLE "InventoryCatalogIntake" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryCatalogIntake" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'InventoryCatalogIntake' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "InventoryCatalogIntake" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "InventoryCatalogIntake" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "InventoryCatalogIntake" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "InventoryCatalogIntake" IS 'FR-208 — one catalogue intake preview (PREVIEWED) and its result (COMMITTED | CANCELLED). normalizedEnvelopeJson is the envelope every surface converts into; planJson is the plan made after resolving each item against the catalogue (CREATE | MATCH | UNCHANGED | CONFLICT | INVALID); a commit must present planHash and applies that plan in one transaction or nothing. Unique per (businessId, sourceChannel, sourceCorrelationId).';

COMMIT;
