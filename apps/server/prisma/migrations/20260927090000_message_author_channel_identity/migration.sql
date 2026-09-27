-- @req FR-022 — attribute each inbound Message to its speaker's ChannelIdentity
-- (PDPA erasure of one speaker in a shared LINE group or room thread).
-- Additive local twin of the Supabase migration with the same timestamp; the
-- Supabase file also carries the production backfill.

ALTER TABLE "Message" ADD COLUMN "authorChannelIdentityId" TEXT;
CREATE INDEX "Message_authorChannelIdentityId_idx" ON "Message"("authorChannelIdentityId");
