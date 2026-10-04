-- @req FR-231, FR-057 — additive, OFF-by-default memory policy and episodic admission snapshot.
-- NOT APPLIED: deployment remains blocked on the signed API-010 contract, trusted scope mapping, receipts and erasure gates.
ALTER TABLE public."LineOaAccount"
  ADD COLUMN IF NOT EXISTS "memoryPolicy" text NOT NULL DEFAULT 'OFF';

ALTER TABLE public."LineConversationJob"
  ADD COLUMN IF NOT EXISTS "episodicMemoryOptIn" boolean NOT NULL DEFAULT false;
