-- @req FR-102 — a Tenant-bound service-account credential for the SoT
-- pipeline's external data plane, distinct from Session and never exposed to
-- the Supabase Data API.
-- @spec ADR-047, SEC-019
-- @tested tests/unit/sot-data-plane-key-migration.test.js
--
-- Created after the canonical IAM runtime-role cutover
-- (20260822204604_canonical_iam_runtime_role_cutover.sql), which granted
-- zuri_app_runtime table access to every table via ALTER DEFAULT PRIVILEGES
-- FOR ROLE postgres — this table inherits that grant automatically because it
-- is created by the same migration-executor role. What ALTER DEFAULT
-- PRIVILEGES does not cover is RLS enablement or a row policy, so both are
-- created explicitly below, matching that migration's own
-- zuri_app_runtime_all shape so a future generic audit of "every table has
-- this policy" finds this one too.

BEGIN;

CREATE TABLE IF NOT EXISTS "SotDataPlaneKey" (
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

CREATE INDEX IF NOT EXISTS "SotDataPlaneKey_tenantId_status_idx" ON "SotDataPlaneKey"("tenantId", "status");

ALTER TABLE "SotDataPlaneKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SotDataPlaneKey" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'SotDataPlaneKey' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "SotDataPlaneKey"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE "SotDataPlaneKey" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "SotDataPlaneKey" IS
  'FR-102 — server-owned service-account credentials for the SoT pipeline data plane. Never exposed to anon/authenticated Data API roles; the raw secret is never stored, only its SHA-256 hash.';

COMMIT;
