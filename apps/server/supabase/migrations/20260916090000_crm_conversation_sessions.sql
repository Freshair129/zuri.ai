-- @req FR-243 — conversation sessions (ADR-094 phase 1): the ConversationSession
-- table, a nullable sessionId on Message and ConversationEvent, and the LINE OA
-- account's idle timeout (10 to 120 minutes, 30 by default).
-- @spec ADR-094 D1–D3; SDD-102; BR-002; ADR-057
-- @tested tests/unit/crm-conversation-sessions-migration.test.js
--
-- Additive and idempotent: one new table, two nullable columns, one column with a
-- default. Every existing Message and ConversationEvent reads as sessionId NULL
-- until `scripts/backfill-conversation-sessions.mjs` assigns it by the same idle
-- rule the application uses; a message admitted after this migration and before
-- the backfill already gets a session, and the backfill reuses that session for
-- older messages inside the same sitting. Every existing LineOaAccount reads as a
-- 30-minute timeout, which is the owner's chosen default.
--
-- NOT APPLIED to production by this change — an owner-instructed operator step
-- (ADR-057, TASK-ZAI-108), dry run first, then the backfill with --apply.

BEGIN;

CREATE TABLE IF NOT EXISTS "ConversationSession" (
  "id"                 TEXT PRIMARY KEY,
  "code"               TEXT NOT NULL,
  "tenantId"           TEXT NOT NULL,
  "businessId"         TEXT,
  "conversationId"     TEXT NOT NULL,
  "customerId"         TEXT NOT NULL,
  "channelAccountId"   TEXT NOT NULL,
  "openedAt"           TIMESTAMP(3) NOT NULL,
  "lastMessageAt"      TIMESTAMP(3) NOT NULL,
  "closedAt"           TIMESTAMP(3),
  "idleTimeoutMinutes" INTEGER NOT NULL,
  "inboundCount"       INTEGER NOT NULL DEFAULT 0,
  "outboundCount"      INTEGER NOT NULL DEFAULT 0,
  "mspSessionId"       TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationSession_tenantId_code_key" ON "ConversationSession"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "ConversationSession_conversationId_openedAt_idx" ON "ConversationSession"("conversationId", "openedAt");
CREATE INDEX IF NOT EXISTS "ConversationSession_tenantId_businessId_openedAt_idx" ON "ConversationSession"("tenantId", "businessId", "openedAt");

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
CREATE INDEX IF NOT EXISTS "Message_sessionId_idx" ON "Message"("sessionId");

ALTER TABLE "ConversationEvent" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
CREATE INDEX IF NOT EXISTS "ConversationEvent_sessionId_idx" ON "ConversationEvent"("sessionId");

ALTER TABLE "LineOaAccount" ADD COLUMN IF NOT EXISTS "sessionIdleTimeoutMinutes" INTEGER NOT NULL DEFAULT 30;

-- schema.prisma declares these relations; SQLite's `prisma db push` gives tests the
-- constraints for free, so only explicit constraints here give production the same
-- cascade and set-null behaviour (same guarded pattern as 20260914150400).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationSession_conversationId_fkey') THEN
    ALTER TABLE "ConversationSession"
      ADD CONSTRAINT "ConversationSession_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Message_sessionId_fkey') THEN
    ALTER TABLE "Message"
      ADD CONSTRAINT "Message_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ConversationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ConversationEvent_sessionId_fkey') THEN
    ALTER TABLE "ConversationEvent"
      ADD CONSTRAINT "ConversationEvent_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "ConversationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- ADR-094 D3 — the timeout is bounded in the database too, so a write that
  -- bypasses the application cannot store a value the session rule would ignore.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LineOaAccount_sessionIdleTimeoutMinutes_range') THEN
    ALTER TABLE "LineOaAccount"
      ADD CONSTRAINT "LineOaAccount_sessionIdleTimeoutMinutes_range"
      CHECK ("sessionIdleTimeoutMinutes" BETWEEN 10 AND 120);
  END IF;
END $$;

ALTER TABLE "ConversationSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationSession" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ConversationSession' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "ConversationSession" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "ConversationSession" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConversationSession" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "ConversationSession" IS 'FR-243 — one sitting of a conversation: messages within the account''s idle timeout of each other (ADR-094). Ids, counts and times only; no message content.';
COMMENT ON COLUMN "Message"."sessionId" IS 'FR-243 — the session this message belongs to; NULL only before the backfill.';
COMMENT ON COLUMN "ConversationEvent"."sessionId" IS 'FR-243 — the session open when the event occurred, or NULL.';
COMMENT ON COLUMN "LineOaAccount"."sessionIdleTimeoutMinutes" IS 'FR-243 — minutes of silence after which the next message opens a new session; 10 to 120.';

COMMIT;
