-- @req FR-022 — attribute each inbound Message to its speaker's ChannelIdentity so
--   PDPA erasure can select a speaker's own words in a LINE group or room thread
--   owned by another Customer (the thread belongs to its first speaker).
-- @spec SEC-001, SEC-005 — tenant, channel and channel account must all match; a
--   provider subject alone never attributes a row across accounts or tenants.
-- Additive migration artifact only; it has not been applied to production.
--
-- Backfill order, most exact first; each pass only fills rows still NULL:
--   1. the answer job admitted for the message (its sourceUserId is the speaker);
--   2. the MESSAGE_INGESTED audit row, whose payload names the speaker's Customer;
--   3. a direct thread, whose externalThreadId is the speaker's own subject.
-- OUTBOUND rows are never attributed.

BEGIN;

ALTER TABLE public."Message"
  ADD COLUMN IF NOT EXISTS "authorChannelIdentityId" TEXT;

CREATE INDEX IF NOT EXISTS "Message_authorChannelIdentityId_idx"
  ON public."Message"("authorChannelIdentityId");

UPDATE public."Message" AS m
SET "authorChannelIdentityId" = ci."id"
FROM public."LineConversationJob" AS j, public."ChannelIdentity" AS ci
WHERE j."inboundMessageId" = m."id"
  AND m."direction" = 'INBOUND'
  AND m."authorChannelIdentityId" IS NULL
  AND ci."tenantId" = j."tenantId"
  AND ci."channel" = 'LINE'
  AND ci."channelAccountId" = j."channelAccountId"
  AND ci."providerSubject" = j."sourceUserId";

UPDATE public."Message" AS m
SET "authorChannelIdentityId" = ci."id"
FROM public."AuditEvent" AS a, public."Conversation" AS c, public."Customer" AS cu, public."ChannelIdentity" AS ci
WHERE a."entityType" = 'CONVERSATION'
  AND a."action" = 'MESSAGE_INGESTED'
  AND a."entityId" = m."conversationId"
  AND (a."payloadJson"::jsonb ->> 'messageId') = m."id"
  AND m."direction" = 'INBOUND'
  AND m."authorChannelIdentityId" IS NULL
  AND c."id" = m."conversationId"
  AND cu."id" = (a."payloadJson"::jsonb ->> 'customerId')
  AND cu."tenantId" = c."tenantId"
  AND ci."tenantId" = c."tenantId"
  AND ci."personId" = cu."personId"
  AND ci."channel" = c."channel"
  AND ci."channelAccountId" = c."channelAccountId";

UPDATE public."Message" AS m
SET "authorChannelIdentityId" = ci."id"
FROM public."Conversation" AS c, public."Customer" AS cu, public."ChannelIdentity" AS ci
WHERE c."id" = m."conversationId"
  AND m."direction" = 'INBOUND'
  AND m."authorChannelIdentityId" IS NULL
  AND cu."id" = c."customerId"
  AND ci."tenantId" = c."tenantId"
  AND ci."personId" = cu."personId"
  AND ci."channel" = c."channel"
  AND ci."channelAccountId" = c."channelAccountId"
  AND ci."providerSubject" = c."externalThreadId";

COMMIT;
