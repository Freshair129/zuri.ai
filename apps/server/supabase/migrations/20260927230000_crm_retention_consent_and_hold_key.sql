-- @req FR-022, SEC-034 — "consent to retain = keep" (owner ruling 2026-09-27,
-- ADR-093 1.2.0): the retention consent a sales user collects in advance from a
-- Customer, and the per-legal-hold data key that re-sealed evidence lives under.
-- @spec ADR-093 1.2.0; SEC-034; BR-001; ADR-057
-- @tested tests/integration/crm-retention-consent.test.js, tests/unit/crm-retention-consent-migration.test.js
--
-- "CustomerRetentionConsent" is a history: recording inserts a row, revoking
-- stamps "revokedAt" on the active row(s); "active" is "revokedAt" IS NULL, read
-- at erasure and sweep time. Business data (no key, no file reference), so it
-- takes real foreign keys to Tenant, Customer and the recording Person and is in
-- the backup snapshot like "CustomerLegalHold" (20260916160000).
--
-- "LegalHoldArchiveKey" is one wrapped data key per legal hold, the same shape
-- and KEK as "CustomerArchiveKey" (20260916150000) and, like it, no foreign key
-- (a plain scope column) and included in the backup snapshot. Deleting its row
-- makes every line re-sealed under that hold unreadable.
--
-- Additive and idempotent. NOT APPLIED to any database by this change — an
-- owner-instructed operator step (ADR-057).

BEGIN;

CREATE TABLE IF NOT EXISTS "CustomerRetentionConsent" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "customerId"         TEXT NOT NULL,
  "businessId"         TEXT NOT NULL,
  "recordedByPersonId" TEXT NOT NULL,
  "recordedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "note"               TEXT,
  "revokedAt"          TIMESTAMP(3),
  "revokedByPersonId"  TEXT,
  CONSTRAINT "CustomerRetentionConsent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerRetentionConsent_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerRetentionConsent_recordedByPersonId_fkey"
    FOREIGN KEY ("recordedByPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CustomerRetentionConsent_tenantId_idx" ON "CustomerRetentionConsent"("tenantId");
CREATE INDEX IF NOT EXISTS "CustomerRetentionConsent_customerId_revokedAt_idx" ON "CustomerRetentionConsent"("customerId", "revokedAt");

ALTER TABLE "CustomerRetentionConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerRetentionConsent" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'CustomerRetentionConsent' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "CustomerRetentionConsent" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "CustomerRetentionConsent" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CustomerRetentionConsent" TO zuri_app_runtime, zuri_web_login;

CREATE TABLE IF NOT EXISTS "LegalHoldArchiveKey" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL,
  "legalHoldId"    TEXT NOT NULL,
  "heldCustomerId" TEXT NOT NULL,
  "kekId"          TEXT NOT NULL,
  "wrappedDek"     TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "LegalHoldArchiveKey_legalHoldId_key" ON "LegalHoldArchiveKey"("legalHoldId");
CREATE INDEX IF NOT EXISTS "LegalHoldArchiveKey_tenantId_idx" ON "LegalHoldArchiveKey"("tenantId");
CREATE INDEX IF NOT EXISTS "LegalHoldArchiveKey_heldCustomerId_idx" ON "LegalHoldArchiveKey"("heldCustomerId");

ALTER TABLE "LegalHoldArchiveKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalHoldArchiveKey" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LegalHoldArchiveKey' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "LegalHoldArchiveKey" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "LegalHoldArchiveKey" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "LegalHoldArchiveKey" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "CustomerRetentionConsent" IS 'FR-022 — retention consent a sales user collected in advance from a Customer (ADR-093 1.2.0). History rows; active while revokedAt is null; read at erasure and retention-sweep time.';
COMMENT ON TABLE "LegalHoldArchiveKey" IS 'SEC-034 — the wrapped data key a legal hold''s re-sealed chat evidence lives under (ADR-093 1.2.0). Deleted when the hold ends, the held Customer''s retention consent is revoked, or the held Customer is erased.';

COMMIT;
