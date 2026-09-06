-- @req FR-148 — preserve historical threads without guessing their OA account.
-- @spec ADR-061, BR-001, SEC-001
ALTER TABLE "Conversation" ADD COLUMN "channelAccountId" TEXT NOT NULL DEFAULT 'LEGACY:LINE';
DROP INDEX "Conversation_tenantId_channel_externalThreadId_key";
CREATE UNIQUE INDEX "Conversation_account_thread_key" ON "Conversation"("tenantId", "channel", "channelAccountId", "externalThreadId");
