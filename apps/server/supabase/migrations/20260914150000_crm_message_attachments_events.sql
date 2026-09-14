-- @req FR-229 — non-text LINE content in the CRM record: Message gains contentKind;
-- MessageAttachment records media without bytes; ConversationEvent records follow,
-- unfollow, join, leave, member joined, member left, postback and unsend (design
-- migration 5, CRM part only — Conversation.lastMessageAt/lastMessagePreview/
-- retentionClass, Message.senderChannelIdentityId/expiresAt and the pg_trgm search
-- index belong to FR-230/FR-233 and are NOT part of this change).
-- @spec ADR-091 D5; BR-002; ADR-057
-- @tested tests/unit/crm-message-attachments-events-migration.test.js
--
-- Additive and idempotent: one column with a default, two new tables. Every
-- existing Message reads as contentKind='TEXT'.
--
-- NOT APPLIED to production by this change — an owner-instructed operator step
-- (ADR-057), dry run first.

BEGIN;

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "contentKind" TEXT NOT NULL DEFAULT 'TEXT';

CREATE TABLE IF NOT EXISTS "MessageAttachment" (
  "id" TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "providerContentId" TEXT,
  "fileAssetId" TEXT,
  "fetchState" TEXT NOT NULL DEFAULT 'PENDING',
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");
CREATE INDEX IF NOT EXISTS "MessageAttachment_fileAssetId_idx" ON "MessageAttachment"("fileAssetId");

CREATE TABLE IF NOT EXISTS "ConversationEvent" (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationEvent_conversationId_externalEventId_key"
  ON "ConversationEvent"("conversationId", "externalEventId");
CREATE INDEX IF NOT EXISTS "ConversationEvent_conversationId_idx" ON "ConversationEvent"("conversationId");

ALTER TABLE "MessageAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageAttachment" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'MessageAttachment' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "MessageAttachment" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "MessageAttachment" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MessageAttachment" TO zuri_app_runtime, zuri_web_login;

ALTER TABLE "ConversationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationEvent" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ConversationEvent' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "ConversationEvent" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "ConversationEvent" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConversationEvent" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "MessageAttachment" IS 'FR-229 — media (image/video/audio/file) recorded without bytes; providerContentId is LINE''s content id for a later fetch phase, cleared on unsend/erasure.';
COMMENT ON TABLE "ConversationEvent" IS 'FR-229 — follow/unfollow/join/leave/memberJoined/memberLeft/postback/unsend as bounded, id-only rows; unsend also tombstones the referenced Message and MessageAttachment.';
COMMENT ON COLUMN "Message"."contentKind" IS 'FR-229 — TEXT | STICKER | LOCATION | MEDIA_REF; media detail lives on MessageAttachment.kind.';

COMMIT;
