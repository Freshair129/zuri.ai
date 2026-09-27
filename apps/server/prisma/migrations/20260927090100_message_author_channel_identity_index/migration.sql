-- @req FR-022 — local twin of the Supabase index migration with the same timestamp
-- (SQLite has no CONCURRENTLY; production builds it concurrently).

CREATE INDEX "Message_authorChannelIdentityId_idx" ON "Message"("authorChannelIdentityId");
