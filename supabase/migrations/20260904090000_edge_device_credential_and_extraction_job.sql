-- @req FR-143, FR-144 — the two tables edge-executed evidence extraction needs:
-- the Business-scoped credential a Zuri Edge Device presents, and the job the
-- cloud queues for it to claim.
-- @spec SDD-085, SEC-025, ADR-059, ADR-041 D3
-- @tested tests/integration/fr144-edge-device-credential.test.js,
--   tests/integration/fr143-asset-extraction-job.test.js
--
-- Additive only: two new tables, their indexes, forced RLS and the same
-- private-application-table grant shape every table in this schema carries
-- (20260830120000_plugin_auth.sql is the pattern). Nothing existing is altered,
-- renamed, dropped or rewritten. Idempotent: safe to run more than once.
--
-- NOT APPLIED to production in this wave. The apply gate is stated in both
-- feature notes; run it with the same procedure as
-- docs/runbooks/line-oa-provider-merge.md §4 (dry run in a rolled-back
-- transaction, then apply and record the version).

BEGIN;

-- ── FR-144 — EdgeDeviceCredential ───────────────────────────────────────────
-- Mirrors ApiAccessKey (FR-106) with one axis narrowed: a device sits at one
-- customer premise, so the credential is bound to one Business, not a Tenant.
-- Only the SHA-256 lookup hash is stored; the raw key exists once, in the mint
-- response, and is unrecoverable afterward.
CREATE TABLE IF NOT EXISTS "EdgeDeviceCredential" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"   TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "deviceId"     TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "keyHash"      TEXT NOT NULL,
  "keyPrefix"    TEXT NOT NULL,
  "status"       TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "revokedAt"    TIMESTAMP(3),
  "revokeReason" TEXT,
  "lastUsedAt"   TIMESTAMP(3),
  "version"      INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "EdgeDeviceCredential_keyHash_key" ON "EdgeDeviceCredential"("keyHash");
CREATE INDEX IF NOT EXISTS "EdgeDeviceCredential_businessId_status_idx" ON "EdgeDeviceCredential"("businessId", "status");
CREATE INDEX IF NOT EXISTS "EdgeDeviceCredential_businessId_deviceId_idx" ON "EdgeDeviceCredential"("businessId", "deviceId");

-- ── FR-143 — AssetExtractionJob ─────────────────────────────────────────────
-- One unit of extraction work. `resultJson` holds the candidate the device
-- posted; the authoritative copy is written onto AssetEvidence.extractionJson by
-- the same transaction, exactly as the cloud provider path writes it.
CREATE TABLE IF NOT EXISTS "AssetExtractionJob" (
  "id"                TEXT PRIMARY KEY,
  "tenantId"          TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"        TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "evidenceId"        TEXT NOT NULL REFERENCES "AssetEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status"            TEXT NOT NULL DEFAULT 'QUEUED',
  "claimedByDeviceId" TEXT,
  "claimedAt"         TIMESTAMP(3),
  "leaseExpiresAt"    TIMESTAMP(3),
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "lastError"         TEXT,
  "resultJson"        TEXT NOT NULL DEFAULT '{}',
  "provider"          TEXT,
  "model"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS "AssetExtractionJob_businessId_status_createdAt_idx" ON "AssetExtractionJob"("businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AssetExtractionJob_evidenceId_status_idx" ON "AssetExtractionJob"("evidenceId", "status");

-- ── RLS and grants — private application tables ─────────────────────────────
ALTER TABLE "EdgeDeviceCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EdgeDeviceCredential" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AssetExtractionJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssetExtractionJob" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['EdgeDeviceCredential', 'AssetExtractionJob'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)',
        target
      );
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON TABLE "EdgeDeviceCredential" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "AssetExtractionJob" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "EdgeDeviceCredential" IS
  'FR-144 — Business-scoped bearer credential for a Zuri Edge Device; SHA-256 hash only, raw key issued once (SEC-025, ADR-041 D3).';
COMMENT ON TABLE "AssetExtractionJob" IS
  'FR-143 — one unit of evidence extraction claimed by an edge device under a time-boxed lease; a candidate is evidence, never approval (BR-025).';

COMMIT;
