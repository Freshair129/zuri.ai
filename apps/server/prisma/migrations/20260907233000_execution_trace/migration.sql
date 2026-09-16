-- @req FR-171 — durable execution trace with exact scoped replay evidence.
-- @spec ADR-070, SEC-001
-- @tested tests/integration/execution-trace.test.js
ALTER TABLE "LineConversationJob" ADD COLUMN "executionId" TEXT;

CREATE TABLE "AgentTraceEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "executionId" TEXT,
  "kind" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "AgentTraceEvent_scope_idempotency_key"
  ON "AgentTraceEvent"("tenantId", "businessId", "idempotencyKey");
CREATE INDEX "AgentTraceEvent_tenantId_businessId_turnId_occurredAt_idx"
  ON "AgentTraceEvent"("tenantId", "businessId", "turnId", "occurredAt");
CREATE INDEX "AgentTraceEvent_tenantId_businessId_turnId_createdAt_idx"
  ON "AgentTraceEvent"("tenantId", "businessId", "turnId", "createdAt");

