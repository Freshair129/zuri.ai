-- @req FR-157 — SalesTask: a follow-up a salesperson owes a customer (call,
-- LINE message, email, meeting, demo, quote), Business-scoped, with an optional
-- Customer and Conversation of the same Tenant and an optional assignee Person.
-- Not a project-manager WorkItem (ADR-064).
-- @spec ADR-064; ADR-054 D3/D4; BR-001; BR-002; SEC-001
-- @tested tests/integration/fr157-sales-task.test.js
--
-- Additive only: one new table, its indexes, foreign keys, forced RLS and the
-- same private-application-table grant shape every table in this schema
-- carries (20260906230000_inventory_domain.sql is the pattern). Nothing
-- existing is altered, renamed, dropped or rewritten. Idempotent: safe to run
-- more than once. Timestamp chosen after checking the directory for a
-- collision (tests/unit/migration-version-uniqueness.test.js guards it).
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

CREATE TABLE IF NOT EXISTS "SalesTask" (
  "id"                  TEXT PRIMARY KEY,
  "code"                TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "businessId"          TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "customerId"          TEXT REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "conversationId"      TEXT REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "assigneePersonId"    TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdByPersonId"   TEXT,
  "title"               TEXT NOT NULL,
  "description"         TEXT,
  "type"                TEXT NOT NULL DEFAULT 'FOLLOW_UP',
  "priority"            TEXT NOT NULL DEFAULT 'NORMAL',
  "status"              TEXT NOT NULL DEFAULT 'OPEN',
  "scheduleKind"        TEXT NOT NULL DEFAULT 'SINGLE',
  "dueDate"             TIMESTAMP(3) NOT NULL,
  "startDate"           TIMESTAMP(3),
  "timeStart"           TEXT,
  "timeEnd"             TEXT,
  "outcome"             TEXT,
  "completedAt"         TIMESTAMP(3),
  "completedByPersonId" TEXT,
  "cancelledAt"         TIMESTAMP(3),
  "cancelReason"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"             INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalesTask_tenantId_code_key" ON "SalesTask"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "SalesTask_businessId_status_dueDate_idx" ON "SalesTask"("businessId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "SalesTask_assigneePersonId_status_idx" ON "SalesTask"("assigneePersonId", "status");
CREATE INDEX IF NOT EXISTS "SalesTask_customerId_idx" ON "SalesTask"("customerId");
CREATE INDEX IF NOT EXISTS "SalesTask_conversationId_idx" ON "SalesTask"("conversationId");

-- ── RLS and grants — private application table ──────────────────────────────
ALTER TABLE "SalesTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesTask" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'SalesTask' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON "SalesTask" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE "SalesTask" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "SalesTask" IS
  'FR-157 — a sales follow-up owed to a customer (crm): Business-scoped, optional Customer/Conversation of the same Tenant, optional assignee; OPEN → IN_PROGRESS → DONE | CANCELLED; not a project-manager WorkItem (ADR-064).';

COMMIT;
