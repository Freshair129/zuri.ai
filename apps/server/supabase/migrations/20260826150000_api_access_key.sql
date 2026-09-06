-- @req FR-106 — a Tenant-bound service-account credential for the FR-019
-- Enterprise API, distinct from Session and SotDataPlaneKey, and never exposed
-- to the Supabase Data API.
-- @spec SEC-006, SEC-001, ADR-047
-- @tested tests/unit/api-access-key-migration.test.js
--
-- Created after the canonical IAM runtime-role cutover
-- (20260822204604_canonical_iam_runtime_role_cutover.sql), which granted
-- zuri_app_runtime table access to every table via ALTER DEFAULT PRIVILEGES
-- FOR ROLE postgres — this table inherits that grant automatically because it
-- is created by the same migration-executor role. What ALTER DEFAULT
-- PRIVILEGES does not cover is RLS enablement or a row policy, so both are
-- created explicitly below, matching that migration's own
-- zuri_app_runtime_all shape (the same discipline as
-- 20260824120000_sot_data_plane_key.sql, which this credential generalizes).

BEGIN;

CREATE TABLE IF NOT EXISTS "ApiAccessKey" (
  "id" text PRIMARY KEY,
  "label" text NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "keyHash" text NOT NULL UNIQUE,
  "keyPrefix" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  "revokeReason" text,
  "lastUsedAt" timestamptz,
  "version" integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS "ApiAccessKey_tenantId_status_idx" ON "ApiAccessKey"("tenantId", "status");

ALTER TABLE "ApiAccessKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiAccessKey" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ApiAccessKey' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "ApiAccessKey"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE "ApiAccessKey" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "ApiAccessKey" IS
  'FR-106 — server-owned Tenant-scoped credentials for the FR-019 Enterprise API. Never exposed to anon/authenticated Data API roles; the raw secret is never stored, only its SHA-256 hash.';

COMMIT;
