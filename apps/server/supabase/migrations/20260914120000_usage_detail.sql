-- @req FR-239 - ProgrammeUsageReport gains usage detail: headline counts
-- (reasoningTokens, toolCallCount, toolErrorCount, promptCount) and the whole
-- detail as canonical JSON (tool names with calls and errors, models, cache
-- lifetimes, web search and fetch, denials, compactions, API errors). Names and
-- numbers only; no prompt, response, argument or output text is ever stored.
-- @spec ADR-086 D7; ADR-057
--
-- Additive and idempotent: four integer columns with a default of 0 and one
-- nullable text column; every existing report reads as "no detail". This
-- migration is a release artifact and is NOT APPLIED to production by this
-- change. Applying is an owner-instructed operator step (ADR-057), dry run first.

BEGIN;

ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "reasoningTokens" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "toolCallCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "toolErrorCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "promptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProgrammeUsageReport" ADD COLUMN IF NOT EXISTS "detailJson" TEXT;

COMMENT ON COLUMN "ProgrammeUsageReport"."detailJson" IS 'FR-239 - canonical usage detail JSON: headline counts, tools {name: {calls, errors}}, models {name: requests}. Names and numbers only (ADR-086 D7).';

COMMIT;
