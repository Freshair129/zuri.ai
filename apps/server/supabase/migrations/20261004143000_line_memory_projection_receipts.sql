-- @req FR-231, FR-232 / @spec ADR-091, ADR-060 — durable projection and erasure receipts.
-- NOT APPLIED: production activation waits for signed MSP API-010 mainline, release gates and owner migration window.
ALTER TABLE public."Customer"
  ADD COLUMN IF NOT EXISTS "memoryErasureStatus" TEXT NOT NULL DEFAULT 'NONE';

CREATE TABLE IF NOT EXISTS public."MemoryProjectionReceipt" (
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
  "acknowledgedAt" TIMESTAMP(3) NOT NULL,
  "deliveryState" TEXT NOT NULL DEFAULT 'PENDING',
  "deliveryAcknowledgedAt" TIMESTAMP(3),
  "deliveryReceiptId" TEXT,
  "erasureStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "erasureReceiptId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "MemoryProjectionReceipt_job_direction_key"
  ON public."MemoryProjectionReceipt"("lineConversationJobId", "direction");
CREATE UNIQUE INDEX IF NOT EXISTS "MemoryProjectionReceipt_crm_direction_key"
  ON public."MemoryProjectionReceipt"("crmMessageId", "direction");
CREATE INDEX IF NOT EXISTS "MemoryProjectionReceipt_erasure_lookup_idx"
  ON public."MemoryProjectionReceipt"("tenantId", "principalId", "erasureStatus");
CREATE INDEX IF NOT EXISTS "MemoryProjectionReceipt_business_created_idx"
  ON public."MemoryProjectionReceipt"("businessId", "createdAt");

REVOKE ALL ON TABLE public."MemoryProjectionReceipt" FROM public, anon, authenticated;
ALTER TABLE public."MemoryProjectionReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MemoryProjectionReceipt" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'MemoryProjectionReceipt'
      AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON public."MemoryProjectionReceipt"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."MemoryProjectionReceipt" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE public."MemoryProjectionReceipt" IS
  'FR-231/FR-232 — scoped MSP append, delivery and erasure identifiers; message content and credentials are never stored.';
