-- @req FR-223 — "IntegrationSecretEnvelope": the envelope store's ciphertext
-- (design migration 4).
-- @spec ADR-089 D1; SDD-097; SEC-030; ADR-057
-- @tested tests/unit/integration/credential-vault-migrations.test.js
--
-- Used only when ZURI_SECRET_STORE=envelope (self-host and generic Postgres,
-- ADR-058 local-db). Created on Supabase too, where it stays empty, so the schema
-- and preflight Check 18 describe one database shape everywhere.
--
-- A row is AES-256-GCM ciphertext under a random per-secret data key; the data key
-- is stored only wrapped by the deployment's key-encryption key, which the
-- database never holds; additional authenticated data binds Tenant, Business,
-- connection and credential version, so a row copied elsewhere does not open.
-- Purge deletes the row. The table is excluded from backup export by name
-- (SNAPSHOT_EXCLUDED_MODELS), and its KEK is never exported.
--
-- Additive and idempotent. NOT APPLIED by the change that writes it — an
-- owner-instructed operator step (ADR-057).

BEGIN;

CREATE TABLE IF NOT EXISTS "IntegrationSecretEnvelope" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT,
  "connectionId" TEXT NOT NULL,
  "kekId" TEXT NOT NULL,
  "wrappedDek" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "aadVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IntegrationSecretEnvelope_tenantId_businessId_connectionId_idx"
  ON "IntegrationSecretEnvelope"("tenantId", "businessId", "connectionId");

ALTER TABLE "IntegrationSecretEnvelope" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationSecretEnvelope" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'IntegrationSecretEnvelope' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "IntegrationSecretEnvelope" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "IntegrationSecretEnvelope" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "IntegrationSecretEnvelope" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "IntegrationSecretEnvelope" IS 'FR-223 — envelope-store ciphertext (ADR-089 D1, SDD-097): AES-256-GCM under a per-secret data key wrapped by a KEK the database never holds; AAD binds Tenant, Business, connection and version. Purge deletes the row. Excluded from backup export; empty on Supabase Vault installations.';

COMMIT;
