-- @req FR-022 — local twin of the Supabase index migration with the same timestamp
-- (SQLite has no CONCURRENTLY; production builds it concurrently).

CREATE INDEX "AgentTraceEvent_kind_occurredAt_id_idx" ON "AgentTraceEvent"("kind", "occurredAt", "id");
