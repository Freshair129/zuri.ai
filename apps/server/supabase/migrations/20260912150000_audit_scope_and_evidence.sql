-- @req FR-198 — audit events carry their own scope and the change they made.
-- @spec ADR-080 D1, BR-036, SDD-095, SEC-003 (additive-only; append-only)
--
-- Unlike ADR-077's migration, this one carries no precondition block: every
-- new column is nullable, every existing row already satisfies "this column
-- is null", and there is no existing-data shape that could violate an
-- ADD COLUMN with no default and no NOT NULL. Nothing here rewrites a row
-- that already exists — that is the whole point (ADR-080 D1: SEC-003 is
-- append-only, so scope on an old row is left null rather than inferred).
BEGIN;

ALTER TABLE "AuditEvent"
  ADD COLUMN "tenantId"   TEXT,
  ADD COLUMN "businessId" TEXT,
  ADD COLUMN "reason"     TEXT,
  ADD COLUMN "beforeJson" TEXT,
  ADD COLUMN "afterJson"  TEXT,
  ADD COLUMN "requestId"  TEXT,
  ADD COLUMN "sessionId"  TEXT;

-- No FK on tenantId/businessId, matching AgentTraceEvent's own choice for the
-- same reason: a hot, append-only journal should not carry a referential
-- action decision, and both columns are already indexed for the query shapes
-- listAccessHistory (FR-199) actually runs.
CREATE INDEX "AuditEvent_tenantId_occurredAt_idx"   ON "AuditEvent" ("tenantId", "occurredAt");
CREATE INDEX "AuditEvent_businessId_occurredAt_idx" ON "AuditEvent" ("businessId", "occurredAt");
CREATE INDEX "AuditEvent_actorId_occurredAt_idx"    ON "AuditEvent" ("actorId", "occurredAt");

COMMIT;
