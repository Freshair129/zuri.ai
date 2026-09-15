-- @req FR-243 — the LINE conversation job carries the conversation session of the
-- inbound message it answers (ADR-094 D4, TASK-ZAI-107), so the job list and its
-- trace can be filtered by session.
-- @spec ADR-094 D4; SDD-102; ADR-057
-- @tested tests/unit/crm-conversation-sessions-migration.test.js
--
-- Additive and idempotent: one nullable column, one index, one foreign key that
-- clears the column when its session is deleted. Requires
-- 20260916090000_crm_conversation_sessions (the ConversationSession table).
-- Existing jobs read as sessionId NULL; `scripts/backfill-conversation-sessions.mjs`
-- copies each job's session from its inbound message once messages are assigned.
--
-- NOT APPLIED to production by this change — an owner-instructed operator step
-- (ADR-057, TASK-ZAI-108), applied together with 20260916090000.

BEGIN;

ALTER TABLE "LineConversationJob" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
CREATE INDEX IF NOT EXISTS "LineConversationJob_sessionId_idx" ON "LineConversationJob"("sessionId");

DO $$
BEGIN
  IF to_regclass('public."ConversationSession"') IS NULL THEN
    RAISE EXCEPTION 'LINE_JOB_SESSION_PRECONDITION_FAILED: 20260916090000_crm_conversation_sessions must be applied first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineConversationJob_sessionId_fkey') THEN
    ALTER TABLE "LineConversationJob"
      ADD CONSTRAINT "LineConversationJob_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ConversationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN "LineConversationJob"."sessionId" IS 'FR-243 — the conversation session of the inbound message this job answers; NULL before the backfill.';

COMMIT;
