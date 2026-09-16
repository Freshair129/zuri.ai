-- @req FR-223 — IntegrationCredential lifecycle metadata and IntegrationCredentialVersion,
-- the append-only version history of the credential vault (design migration 1).
-- @spec ADR-089 D1, D2, D5; SDD-097; SEC-030; ADR-057
-- @tested tests/unit/integration/credential-vault-migrations.test.js, tests/integration/credential-vault.postgres.test.js
--
-- What it adds. Seven columns on "IntegrationCredential" — the store a reference
-- names, the bundle kind, a non-secret display hint (last four of the Channel ID),
-- the last live validation, and revocation — and the "IntegrationCredentialVersion"
-- table: one row per write, so rotation, rejection, revocation and purge are
-- auditable per version. No column anywhere holds material (SEC-030).
--
-- Backfill. `secretStore` is derived from each reference's prefix; `secretKind`
-- from the connection it serves (a LINE_OA provider is LINE_CHANNEL, a Phase-1
-- model connection MODEL_PROVIDER_KEY, anything else API_KEY). Every existing
-- credential gets one BACKFILL version row for the reference it already holds —
-- ACTIVE if the credential resolves today, REVOKED otherwise — so the first
-- browser rotation has a previous version to supersede. Nothing that resolves
-- today stops resolving: statuses and references are not changed.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS, CREATE ... IF NOT EXISTS, the
-- backfills touch only rows they have not touched, the policy is created only when
-- absent. The private-table block (forced RLS, zuri_app_runtime_all, no Data API
-- role) is the standard one of 20260914100000_harness_usage_attribution.sql.
--
-- NOT APPLIED by the change that writes it. Applying is an owner-instructed
-- operator step (ADR-057): dry run in a rolled-back transaction, apply, record the
-- version, verify the columns and the backfill counts.

BEGIN;

ALTER TABLE "IntegrationCredential" ADD COLUMN IF NOT EXISTS "secretStore" TEXT NOT NULL DEFAULT 'DEPLOYMENT_MOUNT';
ALTER TABLE "IntegrationCredential" ADD COLUMN IF NOT EXISTS "secretKind" TEXT NOT NULL DEFAULT 'LINE_CHANNEL';
ALTER TABLE "IntegrationCredential" ADD COLUMN IF NOT EXISTS "displayHint" TEXT;
ALTER TABLE "IntegrationCredential" ADD COLUMN IF NOT EXISTS "lastValidatedAt" TIMESTAMP(3);
ALTER TABLE "IntegrationCredential" ADD COLUMN IF NOT EXISTS "lastValidationCode" TEXT;
ALTER TABLE "IntegrationCredential" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
ALTER TABLE "IntegrationCredential" ADD COLUMN IF NOT EXISTS "revokeReason" TEXT;

UPDATE "IntegrationCredential"
SET "secretStore" = CASE
  WHEN "secretRef" LIKE 'supabase-vault:%' THEN 'SUPABASE_VAULT'
  WHEN "secretRef" LIKE 'envelope:%' THEN 'ENVELOPE'
  ELSE 'DEPLOYMENT_MOUNT'
END
WHERE "secretStore" = 'DEPLOYMENT_MOUNT'
  AND ("secretRef" LIKE 'supabase-vault:%' OR "secretRef" LIKE 'envelope:%');

UPDATE "IntegrationCredential" cr
SET "secretKind" = CASE
  WHEN p."code" = 'LINE_OA' THEN 'LINE_CHANNEL'
  WHEN c."purpose" = 'PHASE1_LINE_LLM' THEN 'MODEL_PROVIDER_KEY'
  ELSE 'API_KEY'
END
FROM "IntegrationConnection" c
JOIN "IntegrationProvider" p ON p."id" = c."providerId"
WHERE c."id" = cr."connectionId"
  AND cr."secretKind" = 'LINE_CHANNEL'
  AND p."code" <> 'LINE_OA';

CREATE TABLE IF NOT EXISTS "IntegrationCredentialVersion" (
  "id" TEXT PRIMARY KEY,
  "credentialId" TEXT NOT NULL REFERENCES "IntegrationCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT,
  "versionNumber" INTEGER NOT NULL,
  "secretRef" TEXT NOT NULL,
  "secretStore" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "displayHint" TEXT,
  "createdById" TEXT,
  "createdVia" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "activatedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  "reason" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationCredentialVersion_credentialId_versionNumber_key"
  ON "IntegrationCredentialVersion"("credentialId", "versionNumber");
CREATE INDEX IF NOT EXISTS "IntegrationCredentialVersion_tenantId_businessId_status_idx"
  ON "IntegrationCredentialVersion"("tenantId", "businessId", "status");
CREATE INDEX IF NOT EXISTS "IntegrationCredentialVersion_secretRef_idx"
  ON "IntegrationCredentialVersion"("secretRef");

INSERT INTO "IntegrationCredentialVersion"
  ("id", "credentialId", "tenantId", "businessId", "versionNumber", "secretRef", "secretStore", "status",
   "createdVia", "createdAt", "activatedAt", "revokedAt")
SELECT
  gen_random_uuid()::text, cr."id", c."tenantId", c."businessId", cr."version", cr."secretRef", cr."secretStore",
  CASE WHEN cr."status" IN ('ACTIVE', 'ROTATING') THEN 'ACTIVE' ELSE 'REVOKED' END,
  'BACKFILL', cr."createdAt",
  CASE WHEN cr."status" IN ('ACTIVE', 'ROTATING') THEN cr."updatedAt" END,
  CASE WHEN cr."status" IN ('ACTIVE', 'ROTATING') THEN NULL ELSE cr."updatedAt" END
FROM "IntegrationCredential" cr
JOIN "IntegrationConnection" c ON c."id" = cr."connectionId"
WHERE NOT EXISTS (
  SELECT 1 FROM "IntegrationCredentialVersion" v WHERE v."credentialId" = cr."id"
);

ALTER TABLE "IntegrationCredentialVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IntegrationCredentialVersion" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'IntegrationCredentialVersion' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "IntegrationCredentialVersion" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "IntegrationCredentialVersion" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "IntegrationCredentialVersion" TO zuri_app_runtime, zuri_web_login;

COMMENT ON COLUMN "IntegrationCredential"."secretStore" IS 'FR-223 — DEPLOYMENT_MOUNT | SUPABASE_VAULT | ENVELOPE: the store the reference prefix names (SDD-097).';
COMMENT ON COLUMN "IntegrationCredential"."displayHint" IS 'FR-223 — last four characters of the non-secret identifier (Channel ID); never any part of a secret or token (SEC-030).';
COMMENT ON TABLE "IntegrationCredentialVersion" IS 'FR-223 — append-only credential version history (ADR-089 D5): PENDING_VALIDATION until live validation, then ACTIVE; SUPERSEDED, REJECTED or REVOKED, and PURGED once the store deleted the material. Holds references and metadata only, never material.';

COMMIT;
