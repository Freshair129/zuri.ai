-- @req FR-265 — keep legacy Server routing as the default while pinning the opt-in runtime cohort.
-- @spec ADR-106 D3, SDD-108
-- Additive migration artifact only; it has not been applied to production.

BEGIN;

ALTER TABLE public."LineOaAccount"
  ADD COLUMN IF NOT EXISTS "runtimeOwner" TEXT NOT NULL DEFAULT 'SERVER';

ALTER TABLE public."LineConversationJob"
  ADD COLUMN IF NOT EXISTS "runtimeOwner" TEXT NOT NULL DEFAULT 'SERVER';

COMMIT;
