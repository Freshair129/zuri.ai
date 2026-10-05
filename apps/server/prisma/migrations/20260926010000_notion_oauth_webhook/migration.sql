-- @req FR-273, FR-274 — Notion OAuth state, encrypted webhook setup token and
-- minimal event receipts. Token ciphertext and ephemeral state are excluded from
-- snapshots; receipts preserve webhook idempotency.
-- @spec ADR-109 D1-D3; SDD-108; SDD-109; SEC-037

CREATE TABLE "NotionOAuthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stateHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX "NotionOAuthState_stateHash_key" ON "NotionOAuthState"("stateHash");
CREATE INDEX "NotionOAuthState_expiresAt_idx" ON "NotionOAuthState"("expiresAt");
CREATE INDEX "NotionOAuthState_tenantId_businessId_actorId_idx"
  ON "NotionOAuthState"("tenantId", "businessId", "actorId");

CREATE TABLE "NotionWebhookVerificationToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kekId" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "revealedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "NotionWebhookReceipt" (
    "eventId" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX "NotionWebhookReceipt_workspaceId_receivedAt_idx"
  ON "NotionWebhookReceipt"("workspaceId", "receivedAt");
CREATE INDEX "NotionWebhookReceipt_occurredAt_idx" ON "NotionWebhookReceipt"("occurredAt");
