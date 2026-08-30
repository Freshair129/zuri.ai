-- FR-127 / ADR-054 D3-D6 — derived CRM conversation analysis.
-- Scope is inherited through Conversation; no tenant/business copy is added.
-- `analyzedDate` groups runs and is intentionally not unique. Every run has a
-- generated internal id, so same-day recomputation remains addressable.
-- This artifact is additive and is not applied by this implementation lane.
BEGIN;

CREATE TABLE IF NOT EXISTS "ConversationAnalysis" (
  "id" text PRIMARY KEY,
  "conversationId" text NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "analyzedDate" timestamptz NOT NULL,
  "analyzedAt" timestamptz NOT NULL DEFAULT now(),
  "contactType" text NOT NULL,
  "state" text NOT NULL,
  "cta" text,
  "tags" text NOT NULL,
  "summary" text NOT NULL,
  "rawOutputJson" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ConversationAnalysis_conversationId_analyzedDate_idx"
  ON "ConversationAnalysis" ("conversationId", "analyzedDate");
CREATE INDEX IF NOT EXISTS "ConversationAnalysis_analyzedDate_idx"
  ON "ConversationAnalysis" ("analyzedDate");
CREATE INDEX IF NOT EXISTS "ConversationAnalysis_contactType_idx"
  ON "ConversationAnalysis" ("contactType");
CREATE INDEX IF NOT EXISTS "ConversationAnalysis_state_idx"
  ON "ConversationAnalysis" ("state");

ALTER TABLE "ConversationAnalysis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationAnalysis" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ConversationAnalysis'
      AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all
      ON "ConversationAnalysis"
      FOR ALL
      TO zuri_app_runtime, zuri_web_login
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE "ConversationAnalysis" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "ConversationAnalysis" IS
  'FR-127 — consent-gated, recomputable CRM analysis runs keyed by internal Conversation.id; private application table.';

COMMIT;
