-- @req FR-239 - usage detail columns on ProgrammeUsageReport (ADR-086 D7).
-- Local twin of supabase/migrations/20260914120000_usage_detail.sql.

-- AlterTable
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN "reasoningTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN "toolCallCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN "toolErrorCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN "promptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN "detailJson" TEXT;
