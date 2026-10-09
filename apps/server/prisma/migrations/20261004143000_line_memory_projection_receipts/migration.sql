-- @req FR-231, FR-232 — durable API-011 projection identity and erasure state.
ALTER TABLE "Customer" ADD COLUMN "memoryErasureStatus" TEXT NOT NULL DEFAULT 'NONE';

CREATE TABLE "MemoryProjectionReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "lineConversationJobId" TEXT NOT NULL,
  "crmMessageId" TEXT,
  "principalId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "episodicMemoryOptIn" BOOLEAN NOT NULL DEFAULT false,
  "mspThreadId" TEXT NOT NULL,
  "mspSessionId" TEXT NOT NULL,
  "mspMessageId" TEXT NOT NULL,
  "mspExchangeId" TEXT NOT NULL,
  "acknowledgedAt" DATETIME NOT NULL,
  "deliveryState" TEXT NOT NULL DEFAULT 'PENDING',
  "deliveryAcknowledgedAt" DATETIME,
  "deliveryReceiptId" TEXT,
  "erasureStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "erasureReceiptId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "MemoryProjectionReceipt_job_direction_key"
  ON "MemoryProjectionReceipt"("lineConversationJobId", "direction");
CREATE UNIQUE INDEX "MemoryProjectionReceipt_crm_direction_key"
  ON "MemoryProjectionReceipt"("crmMessageId", "direction");
CREATE INDEX "MemoryProjectionReceipt_erasure_lookup_idx"
  ON "MemoryProjectionReceipt"("tenantId", "principalId", "erasureStatus");
CREATE INDEX "MemoryProjectionReceipt_business_created_idx"
  ON "MemoryProjectionReceipt"("businessId", "createdAt");
