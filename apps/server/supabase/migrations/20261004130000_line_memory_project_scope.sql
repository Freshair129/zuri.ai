-- @req FR-057, FR-231 / @spec ADR-060 — trusted Publisher-selected API-010 project scope.
-- NOT APPLIED: production activation waits for signed MSP API-010 mainline, rollback review and release acceptance.
ALTER TABLE public."LineOaAccount"
  ADD COLUMN IF NOT EXISTS "memoryProjectId" TEXT;

ALTER TABLE public."LineConversationJob"
  ADD COLUMN IF NOT EXISTS "episodicWorkspaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "episodicProjectId" TEXT;

CREATE INDEX IF NOT EXISTS "LineOaAccount_memoryProjectId_idx"
  ON public."LineOaAccount"("memoryProjectId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'LineOaAccount_memoryProjectId_fkey'
  ) THEN
    ALTER TABLE public."LineOaAccount"
      ADD CONSTRAINT "LineOaAccount_memoryProjectId_fkey"
      FOREIGN KEY ("memoryProjectId") REFERENCES public."Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
