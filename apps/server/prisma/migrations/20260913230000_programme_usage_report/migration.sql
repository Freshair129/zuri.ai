-- @req FR-218 — ProgrammeUsageReport: one agent session's usage for one
-- programme task, reported by an agent without local session logs. Keyed by
-- (source, sessionId); installation-level, no scope foreign keys.
-- @spec ADR-086 D5
-- Additive. This is the local twin of supabase/migrations/20260913230000_programme_usage_report.sql.

-- CreateTable
CREATE TABLE "ProgrammeUsageReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "reportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammeUsageReport_source_sessionId_key" ON "ProgrammeUsageReport"("source", "sessionId");
CREATE INDEX "ProgrammeUsageReport_taskCode_idx" ON "ProgrammeUsageReport"("taskCode");
