-- @req FR-022 — attribute each inbound Message to its speaker's ChannelIdentity
-- (PDPA erasure of one speaker in a shared LINE group or room thread).
-- Additive local twin of the Supabase migration with the same timestamp (step 1:
-- the column). The index and the production backfill are separate Supabase files.

ALTER TABLE "Message" ADD COLUMN "authorChannelIdentityId" TEXT;
