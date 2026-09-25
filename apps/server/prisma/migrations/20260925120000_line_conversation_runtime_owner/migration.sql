-- @spec ADR-106 D3, SDD-108 — durable executor cohort is distinct from SERVER execution mode.
ALTER TABLE "LineOaAccount" ADD COLUMN "runtimeOwner" TEXT NOT NULL DEFAULT 'SERVER';
ALTER TABLE "LineConversationJob" ADD COLUMN "runtimeOwner" TEXT NOT NULL DEFAULT 'SERVER';
