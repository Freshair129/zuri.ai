-- @req FR-220 — HarnessCredential: one paired agent harness installation (Claude
-- Code or Codex). A credential that can only report programme usage, bound to the
-- person who approved the pairing in a signed-in browser and to a server-issued
-- installation id; stored as a SHA-256 hash with a display prefix.
-- @req FR-221 — ProgrammeUsageReport gains attribution: the reported branch (the
-- row key becomes (source, sessionId, branch)), repository, the credential's
-- person and installation, a declared AI account label and extendedAt for a
-- resumed session; taskCode becomes optional because a harness names a branch.
-- @spec ADR-087 D1-D6; ADR-057
--
-- Additive, idempotent, and safe on the current data: ProgrammeUsageReport held
-- 0 rows when this was written (applied 2026-09-14, verified). This migration is
-- a release artifact and is NOT APPLIED to production by this change. Applying is
-- an owner-instructed operator step (ADR-057), dry run first.

BEGIN;

ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "branch" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "repository" TEXT;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "personId" TEXT;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "installationId" TEXT;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "aiAccountLabel" TEXT;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "extendedAt" TIMESTAMP(3);
ALTER TABLE "ProgrammeUsageReport" ALTER COLUMN "taskCode" DROP NOT NULL;
DROP INDEX IF EXISTS "ProgrammeUsageReport_source_sessionId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ProgrammeUsageReport_source_sessionId_branch_key" ON "ProgrammeUsageReport"("source", "sessionId", "branch");
CREATE INDEX IF NOT EXISTS "ProgrammeUsageReport_installationId_idx" ON "ProgrammeUsageReport"("installationId");

CREATE TABLE IF NOT EXISTS "HarnessCredential" (
  "id" TEXT PRIMARY KEY,
  "installationId" TEXT NOT NULL,
  "personId" TEXT NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "harness" TEXT NOT NULL,
  "deviceLabel" TEXT NOT NULL,
  "osUser" TEXT,
  "keyHash" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'PROGRAMME_USAGE_REPORT',
  "status" TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
  "activatedAt" TIMESTAMP(3),
  "activatedByPersonId" TEXT,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedByPersonId" TEXT,
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "HarnessCredential_installationId_key" ON "HarnessCredential"("installationId");
CREATE UNIQUE INDEX IF NOT EXISTS "HarnessCredential_keyHash_key" ON "HarnessCredential"("keyHash");
CREATE INDEX IF NOT EXISTS "HarnessCredential_personId_status_idx" ON "HarnessCredential"("personId", "status");
CREATE INDEX IF NOT EXISTS "HarnessCredential_status_createdAt_idx" ON "HarnessCredential"("status", "createdAt");

ALTER TABLE "HarnessCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HarnessCredential" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'HarnessCredential' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "HarnessCredential" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "HarnessCredential" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "HarnessCredential" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "HarnessCredential" IS 'FR-220 — a paired agent harness installation. Credential scoped to PROGRAMME_USAGE_REPORT only, stored as a SHA-256 hash (keyHash) with a display prefix; bound to the approving Person and a server-issued installationId. ACTIVE when an operator approved it, PENDING_ACTIVATION until an operator activates it, REVOKED on revoke (ADR-087).';

COMMIT;
