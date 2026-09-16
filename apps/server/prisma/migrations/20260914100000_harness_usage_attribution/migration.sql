-- @req FR-220, FR-221 — HarnessCredential and ProgrammeUsageReport attribution
-- (branch key, person, installation, AI account label, extendedAt; taskCode optional).
-- @spec ADR-087 D1-D6
-- Local twin of supabase/migrations/20260914100000_harness_usage_attribution.sql.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProgrammeUsageReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT '',
    "taskCode" TEXT,
    "repository" TEXT,
    "personId" TEXT,
    "installationId" TEXT,
    "aiAccountLabel" TEXT,
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
    "reportedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extendedAt" DATETIME
);
INSERT INTO "new_ProgrammeUsageReport" ("id", "source", "sessionId", "taskCode", "model", "inputTokens", "cacheWriteTokens", "cacheReadTokens", "outputTokens", "requestCount", "activeMinutes", "startedAt", "endedAt", "payloadSha256", "reportedAt") SELECT "id", "source", "sessionId", "taskCode", "model", "inputTokens", "cacheWriteTokens", "cacheReadTokens", "outputTokens", "requestCount", "activeMinutes", "startedAt", "endedAt", "payloadSha256", "reportedAt" FROM "ProgrammeUsageReport";
DROP TABLE "ProgrammeUsageReport";
ALTER TABLE "new_ProgrammeUsageReport" RENAME TO "ProgrammeUsageReport";
CREATE INDEX "ProgrammeUsageReport_taskCode_idx" ON "ProgrammeUsageReport"("taskCode");
CREATE INDEX "ProgrammeUsageReport_installationId_idx" ON "ProgrammeUsageReport"("installationId");
CREATE UNIQUE INDEX "ProgrammeUsageReport_source_sessionId_branch_key" ON "ProgrammeUsageReport"("source", "sessionId", "branch");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "HarnessCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "harness" TEXT NOT NULL,
    "deviceLabel" TEXT NOT NULL,
    "osUser" TEXT,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PROGRAMME_USAGE_REPORT',
    "status" TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "activatedAt" DATETIME,
    "activatedByPersonId" TEXT,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedByPersonId" TEXT,
    "revokeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "HarnessCredential_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HarnessCredential_installationId_key" ON "HarnessCredential"("installationId");
CREATE UNIQUE INDEX "HarnessCredential_keyHash_key" ON "HarnessCredential"("keyHash");
CREATE INDEX "HarnessCredential_personId_status_idx" ON "HarnessCredential"("personId", "status");
CREATE INDEX "HarnessCredential_status_createdAt_idx" ON "HarnessCredential"("status", "createdAt");
