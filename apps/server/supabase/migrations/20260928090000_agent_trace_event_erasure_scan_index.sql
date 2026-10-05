-- @req FR-022 — index for the MSP memory erasure scanner's keyset page
-- (line-memory-erasure.js: PENDING records by kind, oldest first, then id).
-- @spec SEC-001, SEC-005
-- Additive migration artifact only; it has not been applied to production.
--
-- CONCURRENTLY builds the index without blocking writes to "AgentTraceEvent".
-- It cannot run inside a transaction block, so this file has no BEGIN/COMMIT and
-- must be applied on its own (not batched into one transaction with other files).
-- If a build is interrupted it leaves an INVALID index: drop
-- "AgentTraceEvent_kind_occurredAt_id_idx" and re-run this file.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "AgentTraceEvent_kind_occurredAt_id_idx"
  ON public."AgentTraceEvent"("kind", "occurredAt", "id");
