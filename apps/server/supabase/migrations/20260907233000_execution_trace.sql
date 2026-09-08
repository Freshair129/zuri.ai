-- @req FR-171 — private application execution journal; no production application in this change.
-- @spec ADR-070, SEC-001
-- @tested tests/integration/execution-trace.test.js
BEGIN;
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
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX "AgentTraceEvent_scope_idempotency_key"
  ON "AgentTraceEvent"("tenantId", "businessId", "idempotencyKey");
CREATE INDEX "AgentTraceEvent_tenantId_businessId_turnId_occurredAt_idx"
  ON "AgentTraceEvent"("tenantId", "businessId", "turnId", "occurredAt");
CREATE INDEX "AgentTraceEvent_tenantId_businessId_turnId_createdAt_idx"
  ON "AgentTraceEvent"("tenantId", "businessId", "turnId", "createdAt");

ALTER TABLE "AgentTraceEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentTraceEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "AgentTraceEvent"
  FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "AgentTraceEvent" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AgentTraceEvent" TO zuri_app_runtime, zuri_web_login;
COMMENT ON TABLE "AgentTraceEvent" IS 'FR-171 / ADR-070 — scoped immutable execution events; payload redaction only for retention/erasure.';
COMMIT;

