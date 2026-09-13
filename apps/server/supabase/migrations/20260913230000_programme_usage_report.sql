-- @req FR-218 — ProgrammeUsageReport: one agent session's usage for one
-- programme task (ADR-086 D5). An agent without local session logs reports it
-- through POST /api/platform/programme-usage-reports under the deployment bearer
-- ZURI_PROGRAMME_USAGE_TOKEN. Keyed by (source, sessionId) so a replay is
-- idempotent; payloadSha256 distinguishes a replay from a conflicting report.
-- Installation-level operations data: no Tenant, Business or Person scope, no
-- prompt or response content — four token counts, a time span and a task id.
-- @spec ADR-086 D5; ADR-057
--
-- Additive and idempotent. This migration is a release artifact and is
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057), dry run first. Until it is applied the programme
-- board reads no reports and still renders.

BEGIN;

CREATE TABLE IF NOT EXISTS "ProgrammeUsageReport" (
  "id" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "taskCode" TEXT NOT NULL,
  "model" TEXT,
  "inputTokens" INTEGER NOT NULL,
  "cacheWriteTokens" INTEGER NOT NULL,
  "cacheReadTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "requestCount" INTEGER NOT NULL,
  "activeMinutes" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3) NOT NULL,
  "payloadSha256" TEXT NOT NULL,
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProgrammeUsageReport_source_sessionId_key" ON "ProgrammeUsageReport"("source", "sessionId");
CREATE INDEX IF NOT EXISTS "ProgrammeUsageReport_taskCode_idx" ON "ProgrammeUsageReport"("taskCode");

ALTER TABLE "ProgrammeUsageReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProgrammeUsageReport" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ProgrammeUsageReport' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "ProgrammeUsageReport" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "ProgrammeUsageReport" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ProgrammeUsageReport" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "ProgrammeUsageReport" IS 'FR-218 — one agent session''s usage for one programme task, reported by an agent without local session logs (ADR-086 D5). Unique per (source, sessionId). Tokens: input (not cached), cache write, cache read, output. Measured cost beside the plan, never programme progress.';

COMMIT;
