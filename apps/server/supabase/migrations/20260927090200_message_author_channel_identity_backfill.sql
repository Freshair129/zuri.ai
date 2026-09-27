-- @req FR-022 — backfill Message.authorChannelIdentityId for inbound rows.
-- @spec SEC-001, SEC-005 — tenant, channel and channel account must all match; a
--   provider subject alone never attributes a row across accounts or tenants.
-- Additive migration artifact only; it has not been applied to production.
--
-- Step 3 of 3. No BEGIN/COMMIT: each UPDATE commits on its own and touches at most
-- 5000 rows, holding only row locks (ROW EXCLUSIVE on "Message"), never the
-- ACCESS EXCLUSIVE lock of step 1. Every statement fills only rows still NULL, so
-- the file is idempotent: re-run it until all three UPDATEs report 0 rows.
-- Nothing depends on completion: erasure attributes any row still NULL through its
-- MESSAGE_INGESTED audit row at erase time and writes the author back.
--
-- Passes, most exact first; OUTBOUND rows are never attributed:
--   1. the answer job admitted for the message (its sourceUserId is the speaker);
--   2. the MESSAGE_INGESTED audit row, whose payload names the speaker's Customer;
--   3. a direct thread, whose externalThreadId is the speaker's own subject.

UPDATE public."Message" AS m
SET "authorChannelIdentityId" = src.identity_id
FROM (
  SELECT DISTINCT ON (msg."id") msg."id" AS message_id, ci."id" AS identity_id
  FROM public."Message" AS msg
  JOIN public."LineConversationJob" AS j ON j."inboundMessageId" = msg."id"
  JOIN public."ChannelIdentity" AS ci
    ON ci."tenantId" = j."tenantId" AND ci."channel" = 'LINE'
   AND ci."channelAccountId" = j."channelAccountId" AND ci."providerSubject" = j."sourceUserId"
  WHERE msg."direction" = 'INBOUND' AND msg."authorChannelIdentityId" IS NULL
  ORDER BY msg."id", ci."id"
  LIMIT 5000
) AS src
WHERE m."id" = src.message_id AND m."authorChannelIdentityId" IS NULL;

UPDATE public."Message" AS m
SET "authorChannelIdentityId" = src.identity_id
FROM (
  SELECT DISTINCT ON (msg."id") msg."id" AS message_id, ci."id" AS identity_id
  FROM public."Message" AS msg
  JOIN public."Conversation" AS c ON c."id" = msg."conversationId"
  JOIN public."AuditEvent" AS a
    ON a."entityType" = 'CONVERSATION' AND a."action" = 'MESSAGE_INGESTED' AND a."entityId" = msg."conversationId"
   AND (a."payloadJson"::jsonb ->> 'messageId') = msg."id"
   AND (a."payloadJson"::jsonb ->> 'tenantId') = c."tenantId"
   AND (a."payloadJson"::jsonb ->> 'channelAccountId') = c."channelAccountId"
  JOIN public."Customer" AS cu
    ON cu."id" = (a."payloadJson"::jsonb ->> 'customerId') AND cu."tenantId" = c."tenantId"
  JOIN public."ChannelIdentity" AS ci
    ON ci."tenantId" = c."tenantId" AND ci."personId" = cu."personId"
   AND ci."channel" = c."channel" AND ci."channelAccountId" = c."channelAccountId"
  WHERE msg."direction" = 'INBOUND' AND msg."authorChannelIdentityId" IS NULL
  ORDER BY msg."id", ci."id"
  LIMIT 5000
) AS src
WHERE m."id" = src.message_id AND m."authorChannelIdentityId" IS NULL;

UPDATE public."Message" AS m
SET "authorChannelIdentityId" = src.identity_id
FROM (
  SELECT DISTINCT ON (msg."id") msg."id" AS message_id, ci."id" AS identity_id
  FROM public."Message" AS msg
  JOIN public."Conversation" AS c ON c."id" = msg."conversationId"
  JOIN public."Customer" AS cu ON cu."id" = c."customerId"
  JOIN public."ChannelIdentity" AS ci
    ON ci."tenantId" = c."tenantId" AND ci."personId" = cu."personId"
   AND ci."channel" = c."channel" AND ci."channelAccountId" = c."channelAccountId"
   AND ci."providerSubject" = c."externalThreadId"
  WHERE msg."direction" = 'INBOUND' AND msg."authorChannelIdentityId" IS NULL
  ORDER BY msg."id", ci."id"
  LIMIT 5000
) AS src
WHERE m."id" = src.message_id AND m."authorChannelIdentityId" IS NULL;
