-- @req FR-149, FR-171 — immutable per-job MSP enrollment and durable receipt recovery.
-- @spec ADR-061, ADR-070, SEC-001
-- Additive parity migration. Existing jobs remain outside the opt-in path.
BEGIN;
ALTER TABLE "LineConversationJob" ADD COLUMN "audienceKind" TEXT NOT NULL DEFAULT 'DIRECT';
ALTER TABLE "LineConversationJob" ADD COLUMN "memorySyncOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LineConversationJob" ADD COLUMN "memoryDeliveryState" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "LineConversationJob" ADD COLUMN "memoryDeliveryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LineConversationJob" ADD COLUMN "memoryDeliveryNextAttemptAt" TIMESTAMP(3);
ALTER TABLE "LineConversationJob" ADD COLUMN "memoryDeliveryLeaseUntil" TIMESTAMP(3);
CREATE INDEX "LineConversationJob_memoryDeliveryState_memoryDeliveryNextA_idx"
  ON "LineConversationJob"("memoryDeliveryState", "memoryDeliveryNextAttemptAt", "createdAt");
COMMIT;
