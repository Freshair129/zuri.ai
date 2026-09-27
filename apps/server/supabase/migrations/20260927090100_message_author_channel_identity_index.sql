-- @req FR-022 — index for erasure's per-speaker Message selection.
-- @spec SEC-001, SEC-005
-- Additive migration artifact only; it has not been applied to production.
--
-- Step 2 of 3. CONCURRENTLY builds the index without blocking writes to
-- "Message". It cannot run inside a transaction block, so this file has no
-- BEGIN/COMMIT and must be applied on its own (not batched into one transaction
-- with other files). If a build is interrupted it leaves an INVALID index: drop
-- "Message_authorChannelIdentityId_idx" and re-run this file.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Message_authorChannelIdentityId_idx"
  ON public."Message"("authorChannelIdentityId");
