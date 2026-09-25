-- @spec ADR-106 D3, SDD-108 — durable executor cohort is distinct from SERVER execution mode.
ALTER TABLE "LineOaAccount" ADD COLUMN IF NOT EXISTS "runtimeOwner" TEXT NOT NULL DEFAULT 'SERVER';
ALTER TABLE "LineConversationJob" ADD COLUMN IF NOT EXISTS "runtimeOwner" TEXT NOT NULL DEFAULT 'SERVER';
