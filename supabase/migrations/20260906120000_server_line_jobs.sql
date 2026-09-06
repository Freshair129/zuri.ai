-- @req FR-149, FR-150 — server-owned LINE queue, default-off upgrade.
-- @spec ADR-061, SEC-001
BEGIN;
ALTER TABLE public."LineOaAccount" ADD COLUMN IF NOT EXISTS "serverEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public."LineOaAccount" ADD COLUMN IF NOT EXISTS "executionMode" TEXT NOT NULL DEFAULT 'SERVER';
ALTER TABLE public."LineOaAccount" ADD COLUMN IF NOT EXISTS "modelAccess" TEXT NOT NULL DEFAULT 'LOCAL_ONLY';
ALTER TABLE public."LineOaAccount" ADD COLUMN IF NOT EXISTS "allowDelayedPush" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public."LineOaAccount" ADD COLUMN IF NOT EXISTS "transportEpoch" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE public."LineConversationJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "transportEpoch" INTEGER NOT NULL,
    "executionMode" TEXT NOT NULL,
    "modelAccess" TEXT NOT NULL,
    "allowDelayedPush" BOOLEAN NOT NULL DEFAULT false,
    "recipientId" TEXT NOT NULL,
    "sourceUserId" TEXT NOT NULL,
    "sealedReplyToken" TEXT,
    "replyExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "answerText" TEXT,
    "sendMethod" TEXT,
    "retryKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstSendAt" TIMESTAMP(3),
    "claimantId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "providerRequestId" TEXT,
    "providerMessageId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LineConversationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_inboundMessageId_key" ON public."LineConversationJob"("inboundMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_retryKey_key" ON public."LineConversationJob"("retryKey");

-- CreateIndex
CREATE INDEX "LineConversationJob_status_executionMode_availableAt_idx" ON public."LineConversationJob"("status", "executionMode", "availableAt");

-- CreateIndex
CREATE INDEX "LineConversationJob_tenantId_businessId_status_idx" ON public."LineConversationJob"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_accountId_eventId_key" ON public."LineConversationJob"("accountId", "eventId");

-- AddForeignKey
ALTER TABLE public."LineConversationJob" ADD CONSTRAINT "LineConversationJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public."LineOaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE public."LineConversationJob" ADD CONSTRAINT "LineConversationJob_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES public."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

REVOKE ALL ON public."LineConversationJob" FROM anon, authenticated;
ALTER TABLE public."LineConversationJob" ENABLE ROW LEVEL SECURITY;

COMMIT;
