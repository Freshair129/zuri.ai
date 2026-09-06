-- @req FR-076, FR-122, FR-036, FR-046 — record, in the production lineage, four
-- pieces of schema that production already has and no migration here ever
-- created: the password-auth tables PersonCredential and PasswordResetToken
-- (identity), the PlanImportReceipt table and the eight Workstream
-- execution-contract columns (project-manager).
-- @spec docs/DB-MIGRATION-NOTES.md §Migration discipline; ADR-057
-- @tested tests/unit/schema-migration-drift.test.js
--
-- Why this file exists: preflight `schema-migration-drift` (Check 18) compares
-- the generated prisma/schema.postgres.prisma against what supabase/migrations/
-- creates, and on 2026-09-06 found these 33 columns declared and never
-- migrated. The deploy-role session verified the same day that production HAS
-- all of them — PersonCredential and PasswordResetToken were created by hand
-- before this lineage existed (9a149d6 declared them in the schema so `db push`
-- would stop proposing to drop them); PlanImportReceipt and the Workstream
-- columns (be14e20, PR #67) reached production through the 2026-08-18 dump and
-- hand-applied DDL. So this is a RECORDING migration: every statement is
-- IF NOT EXISTS or guarded, it is a no-op on production, and after it the
-- lineage describes the database it governs. It repays every entry in
-- docs/.schema-migration-baseline.json.
--
-- DDL is copied from prisma/postgres/0001_init.sql (generated from the same
-- schema) so the shape matches what Prisma expects. RLS and grants: the
-- 2026-08-21 hardening (20260821103000_public_rls_hardening.sql) enabled RLS on
-- every public table and set default privileges for future ones, and the
-- tables already exist on production under that regime; this file does not
-- touch policies or grants.
--
-- NOT APPLIED by the change that writes it. On production it changes nothing
-- (verified 2026-09-06), but recording the version in
-- supabase_migrations.schema_migrations is still an owner-instructed operator
-- step (ADR-057) for the deploy-role session — dry run first, as always.

BEGIN;

-- ── identity — PersonCredential ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PersonCredential" (
  "id"           TEXT NOT NULL,
  "personId"     TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PersonCredential_personId_key" ON "PersonCredential"("personId");

-- ── identity — PasswordResetToken ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id"        TEXT NOT NULL,
  "personId"  TEXT NOT NULL,
  "token"     TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_token_key" ON "PasswordResetToken"("token");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_personId_idx" ON "PasswordResetToken"("personId");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- ── project-manager — PlanImportReceipt ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PlanImportReceipt" (
  "idempotencyKey"          TEXT NOT NULL,
  "payloadHash"             TEXT NOT NULL,
  "executionRunId"          TEXT NOT NULL,
  "executionStepId"         TEXT,
  "attemptId"               TEXT,
  "stepKey"                 TEXT NOT NULL DEFAULT 'plan.import.commit',
  "status"                  TEXT NOT NULL DEFAULT 'SUCCEEDED',
  "correlationId"           TEXT NOT NULL,
  "schemaVersion"           TEXT NOT NULL,
  "projectId"               TEXT NOT NULL,
  "replayOfExecutionRunId"  TEXT,
  "replayOfExecutionStepId" TEXT,
  "auditEventId"            TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanImportReceipt_pkey" PRIMARY KEY ("idempotencyKey")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlanImportReceipt_executionRunId_key" ON "PlanImportReceipt"("executionRunId");
CREATE INDEX IF NOT EXISTS "PlanImportReceipt_projectId_idx" ON "PlanImportReceipt"("projectId");
CREATE INDEX IF NOT EXISTS "PlanImportReceipt_correlationId_idx" ON "PlanImportReceipt"("correlationId");
CREATE INDEX IF NOT EXISTS "PlanImportReceipt_replayOfExecutionRunId_idx" ON "PlanImportReceipt"("replayOfExecutionRunId");

-- ── project-manager — Workstream execution-contract columns ──────────────────
ALTER TABLE "Workstream"
  ADD COLUMN IF NOT EXISTS "executionModeId"         TEXT,
  ADD COLUMN IF NOT EXISTS "laneId"                  TEXT,
  ADD COLUMN IF NOT EXISTS "executionContractId"     TEXT,
  ADD COLUMN IF NOT EXISTS "contractVersion"         TEXT,
  ADD COLUMN IF NOT EXISTS "primaryDomainId"         TEXT,
  ADD COLUMN IF NOT EXISTS "supportingDomainIdsJson" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "technicalOwnerDomainId"  TEXT,
  ADD COLUMN IF NOT EXISTS "identityRefsJson"        TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "Workstream_executionModeId_idx" ON "Workstream"("executionModeId");
CREATE INDEX IF NOT EXISTS "Workstream_laneId_idx" ON "Workstream"("laneId");

-- ── foreign keys, guarded by name ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonCredential_personId_fkey') THEN
    ALTER TABLE "PersonCredential" ADD CONSTRAINT "PersonCredential_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordResetToken_personId_fkey') THEN
    ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanImportReceipt_projectId_fkey') THEN
    ALTER TABLE "PlanImportReceipt" ADD CONSTRAINT "PlanImportReceipt_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
