-- FR-023 / BR-001 / BR-002 / SEC-001 — tenant-partition the external id namespace.
--
-- `Conversation.externalThreadId` and `Message.externalMessageId` carried a GLOBAL
-- UNIQUE, so a provider id was effectively a primary key across every tenant. One
-- tenant presenting another's thread id appended into that tenant's conversation, and
-- one presenting another's message id received that tenant's conversation, customer
-- and message ids back through the idempotency short-circuit.
--
-- Both new constraints are strictly WEAKER than the ones they replace: a globally
-- unique column is trivially unique within any grouping of it. No existing row can
-- violate them, so this migration needs no backfill and cannot fail on live data.
--
-- NULL stays non-conflicting in both SQLite and Postgres, so outbound messages with no
-- provider id continue to coexist in one conversation.

DROP INDEX "Conversation_externalThreadId_key";
CREATE UNIQUE INDEX "Conversation_tenantId_channel_externalThreadId_key" ON "Conversation"("tenantId", "channel", "externalThreadId");

DROP INDEX "Message_externalMessageId_key";
CREATE UNIQUE INDEX "Message_conversationId_externalMessageId_key" ON "Message"("conversationId", "externalMessageId");
