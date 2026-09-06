-- @req FR-149, FR-150 — server-owned LINE queue, default-off upgrade.
-- @spec ADR-061, SEC-001
ALTER TABLE "LineOaAccount" ADD COLUMN "serverEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LineOaAccount" ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'SERVER';
ALTER TABLE "LineOaAccount" ADD COLUMN "modelAccess" TEXT NOT NULL DEFAULT 'LOCAL_ONLY';
ALTER TABLE "LineOaAccount" ADD COLUMN "allowDelayedPush" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LineOaAccount" ADD COLUMN "transportEpoch" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "LineConversationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "replyExpiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "answerText" TEXT,
    "sendMethod" TEXT,
    "retryKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "firstSendAt" DATETIME,
    "claimantId" TEXT,
    "leaseExpiresAt" DATETIME,
    "providerRequestId" TEXT,
    "providerMessageId" TEXT,
    "acceptedAt" DATETIME,
    "errorCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "LineConversationJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LineOaAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineConversationJob_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_inboundMessageId_key" ON "LineConversationJob"("inboundMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_retryKey_key" ON "LineConversationJob"("retryKey");

-- CreateIndex
CREATE INDEX "LineConversationJob_status_executionMode_availableAt_idx" ON "LineConversationJob"("status", "executionMode", "availableAt");

-- CreateIndex
CREATE INDEX "LineConversationJob_tenantId_businessId_status_idx" ON "LineConversationJob"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_accountId_eventId_key" ON "LineConversationJob"("accountId", "eventId");
