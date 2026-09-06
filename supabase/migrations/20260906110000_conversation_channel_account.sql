-- @req FR-148 — account-scoped CRM threads for the production public schema.
-- @spec ADR-061, BR-001, SEC-001
-- Historical rows remain LEGACY:LINE. Never infer an account from a current binding.
-- Existing Conversation RLS/grants are unchanged. Run by the migration owner.
BEGIN;
ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "channelAccountId" TEXT NOT NULL DEFAULT 'LEGACY:LINE';
DROP INDEX IF EXISTS public."Conversation_tenantId_channel_externalThreadId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_account_thread_key" ON public."Conversation"("tenantId", "channel", "channelAccountId", "externalThreadId");
COMMIT;
