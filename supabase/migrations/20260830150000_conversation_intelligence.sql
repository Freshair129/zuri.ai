-- @req FR-126, FR-127, FR-128 — the FEAT-014 derived-intelligence tables: the
-- AI-inferred CustomerProfile (1:1 on Customer), the per-run
-- ConversationAnalysis, and the per-(Business, briefDate) DailyBrief. All three
-- hold derived, recomputable, advisory data (ADR-054 D6): the truth stays in
-- Conversation/Message, and every row here is regenerable.
-- @spec ADR-054, BR-002, SEC-001, SEC-005
-- @tested tests/integration/crm-conversation-intelligence.test.js
--
-- Scope is inherited, never restated (ADR-054 D3): CustomerProfile hangs off the
-- tenant-scoped Customer, ConversationAnalysis off the tenant-scoped
-- Conversation — both with ON DELETE CASCADE, because derived personal data
-- falls with its aggregate under PDPA erasure (SEC-005). DailyBrief carries
-- (tenantId, businessId) the way Branch does.
--
-- Additive and idempotent by construction (CREATE TABLE IF NOT EXISTS, CREATE
-- INDEX IF NOT EXISTS, policies guarded by pg_policies lookups) — the same
-- shape as 20260826150000_api_access_key.sql. Created after the canonical IAM
-- runtime-role cutover, so zuri_app_runtime table grants arrive via ALTER
-- DEFAULT PRIVILEGES; RLS enablement and the row policy are created explicitly
-- because that is what default privileges do not cover.

BEGIN;

CREATE TABLE IF NOT EXISTS "CustomerProfile" (
  "id" text PRIMARY KEY,
  "customerId" text NOT NULL UNIQUE REFERENCES "Customer"("id") ON DELETE CASCADE,
  "demographicBand" text,
  "occupation" text,
  "motivationsJson" text NOT NULL DEFAULT '[]',
  "budgetSignal" text,
  "inferenceCount" integer NOT NULL DEFAULT 0,
  "lastInferredAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ConversationAnalysis" (
  "id" text PRIMARY KEY,
  "conversationId" text NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
  "analyzedDate" text NOT NULL,
  "contactType" text NOT NULL,
  "state" text NOT NULL,
  "cta" text,
  "tagsJson" text NOT NULL DEFAULT '[]',
  "summary" text,
  "rawOutputJson" text,
  "analyzedAt" timestamptz NOT NULL DEFAULT now(),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ConversationAnalysis_conversationId_analyzedDate_idx"
  ON "ConversationAnalysis"("conversationId", "analyzedDate");
CREATE INDEX IF NOT EXISTS "ConversationAnalysis_analyzedDate_state_idx"
  ON "ConversationAnalysis"("analyzedDate", "state");

CREATE TABLE IF NOT EXISTS "DailyBrief" (
  "id" text PRIMARY KEY,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "businessId" text NOT NULL REFERENCES "Business"("id"),
  "briefDate" text NOT NULL,
  "totalConversations" integer NOT NULL DEFAULT 0,
  "totalAnalyzed" integer NOT NULL DEFAULT 0,
  "stateCountsJson" text NOT NULL DEFAULT '{}',
  "topCtasJson" text NOT NULL DEFAULT '[]',
  "topTagsJson" text NOT NULL DEFAULT '[]',
  "status" text NOT NULL DEFAULT 'PENDING',
  "processedAt" timestamptz,
  "sentAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "DailyBrief_businessId_briefDate_key" UNIQUE ("businessId", "briefDate")
);

CREATE INDEX IF NOT EXISTS "DailyBrief_tenantId_briefDate_idx" ON "DailyBrief"("tenantId", "briefDate");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CustomerProfile', 'ConversationAnalysis', 'DailyBrief'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)', t
      );
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I FROM public, anon, authenticated, service_role', t);
  END LOOP;
END $$;

COMMENT ON TABLE "CustomerProfile" IS
  'FR-126 — AI-inferred advisory profile, 1:1 on Customer. Derived personal data (SEC-005): regenerable, falls with the Customer, never identity.';
COMMENT ON TABLE "ConversationAnalysis" IS
  'FR-127 — per-Conversation, per-run AI classification. Keyed to Conversation.id, never the external thread id (BR-002). Recomputable from Message rows.';
COMMENT ON TABLE "DailyBrief" IS
  'FR-128 — one aggregate per (Business, briefDate), recomputed whole from ConversationAnalysis, never incremented. Delivery record, not a source of truth.';

COMMIT;
