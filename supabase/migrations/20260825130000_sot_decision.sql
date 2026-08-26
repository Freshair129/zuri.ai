-- @req FR-100 — the SoT pipeline's generic human-decision queue: the data
-- plane submits, a human decides, the data plane pulls by cursor. zuri-ai
-- never writes into the retrieval substrate (ADR-043 interim boundary).
-- @spec FR-100, BR-002, SEC-002
-- @tested tests/unit/sot-decision-service.test.js
--
-- This table shipped in PR #105 with unit/contract tests but no production
-- Supabase migration -- discovered 2026-08-25 while running the FR-102
-- connector's first real submit against production (`relation "SotDecision"
-- does not exist`). Written now, following the same server-owned RLS+policy
-- pattern as 20260824120000_sot_data_plane_key.sql and the canonical IAM
-- runtime-role cutover -- timestamptz (not `prisma migrate diff`'s
-- TIMESTAMP(3)) to match every other hand-written migration in this
-- directory; the generated prisma/postgres/0001_init.sql is a lab
-- invariant, not the production schema authority (docs/DB-MIGRATION-NOTES.md).

BEGIN;

CREATE TABLE IF NOT EXISTS "SotDecision" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "businessId" text REFERENCES "Business"("id") ON DELETE CASCADE,
  "decisionType" text NOT NULL,
  "subjectRef" text NOT NULL,
  "phaseId" text,
  "payloadJson" text NOT NULL DEFAULT '{}',
  "payloadSha256" text NOT NULL,
  "decisionVersion" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'PENDING',
  "submittedBy" text,
  "decidedByPersonId" text,
  "reason" text,
  "auditEventId" text,
  "decidedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "SotDecision_tenantId_decisionType_subjectRef_decisionVersio_key"
  ON "SotDecision"("tenantId", "decisionType", "subjectRef", "decisionVersion");
CREATE INDEX IF NOT EXISTS "SotDecision_tenantId_status_decisionType_idx" ON "SotDecision"("tenantId", "status", "decisionType");
CREATE INDEX IF NOT EXISTS "SotDecision_businessId_status_idx" ON "SotDecision"("businessId", "status");
CREATE INDEX IF NOT EXISTS "SotDecision_phaseId_status_idx" ON "SotDecision"("phaseId", "status");
CREATE INDEX IF NOT EXISTS "SotDecision_updatedAt_idx" ON "SotDecision"("updatedAt");

ALTER TABLE "SotDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SotDecision" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'SotDecision' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "SotDecision"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE "SotDecision" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "SotDecision" IS
  'FR-100 -- server-owned SoT pipeline decision queue. Never exposed to anon/authenticated Data API roles; the browser reaches it only through the Zuri server API.';

COMMIT;
