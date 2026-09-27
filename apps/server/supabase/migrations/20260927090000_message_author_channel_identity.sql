-- @req FR-022 — attribute each inbound Message to its speaker's ChannelIdentity so
--   PDPA erasure can select a speaker's own words in a LINE group or room thread
--   owned by another Customer (the thread belongs to its first speaker).
-- @spec SEC-001, SEC-005
-- Additive migration artifact only; it has not been applied to production.
--
-- Step 1 of 3. The column alone: nullable, no default, so ADD COLUMN is a catalog
-- change that takes ACCESS EXCLUSIVE on "Message" only for the instant it runs and
-- rewrites nothing. The index (20260927090100, CONCURRENTLY) and the batched
-- backfill (20260927090200) are separate files so neither runs under this lock.
-- Until the backfill finishes, erasure attributes a NULL-author row at erase time
-- through its MESSAGE_INGESTED audit row and writes the author back.

BEGIN;

ALTER TABLE public."Message"
  ADD COLUMN IF NOT EXISTS "authorChannelIdentityId" TEXT;

COMMIT;
