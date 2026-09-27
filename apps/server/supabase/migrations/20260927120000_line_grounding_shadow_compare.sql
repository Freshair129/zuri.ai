-- @req FR-277 — LINE grounding shadow-compare harness (ADR-090 Phase 3,
-- TASK-ZAI-095). A LINE OA account gains a publisher/operator-set
-- `knowledgeGroundingShadow` flag, independent of `knowledgeGrounding`
-- (default false, so no account's behaviour changes until an operator turns
-- it on for the one campaign window). When true, a SERVER job's primary
-- answer is unchanged; a second, best-effort generation under the account's
-- OTHER grounding mode is recorded — never sent to the customer — as one
-- `LineGroundingShadowComparison` row per job.
-- @spec ADR-090 D1-D3, SEC-032 — the comparison row carries the same answer
--   text the primary path already sends the customer (no new customer
--   content), plus evidence-source/reason, latency and outcome only.
--
-- Additive only: one new column with a default and one new table, both
-- `IF NOT EXISTS`, so this file is idempotent. Nothing existing is altered,
-- renamed, dropped or rewritten.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057): dry run in a rolled-back transaction, then apply
-- and record the version — see the sibling switch/rollback runbook for
-- TASK-ZAI-095, which this harness does not itself apply.

BEGIN;

ALTER TABLE public."LineOaAccount"
  ADD COLUMN IF NOT EXISTS "knowledgeGroundingShadow" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public."LineOaAccount"."knowledgeGroundingShadow" IS
  'FR-277 — default false. When true, a SERVER job also runs a best-effort, non-blocking generation under this account''s paired grounding mode after the real answer, recorded in LineGroundingShadowComparison and never sent to the customer.';

CREATE TABLE IF NOT EXISTS public."LineGroundingShadowComparison" (
  "id" text PRIMARY KEY,
  "jobId" text NOT NULL UNIQUE,
  "tenantId" text NOT NULL,
  "businessId" text NOT NULL,
  "accountId" text,
  "primaryMode" text NOT NULL,
  "shadowMode" text NOT NULL,
  "status" text NOT NULL,
  "primaryAnswerText" text,
  "shadowAnswerText" text,
  "shadowEvidenceSource" text,
  "shadowEvidenceReason" text,
  "shadowRetrievalRefsJson" text,
  "answersDiverge" boolean,
  "latencyMs" integer,
  "errorCode" text,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "LineGroundingShadowComparison_tenantId_businessId_createdAt_idx"
  ON public."LineGroundingShadowComparison"("tenantId", "businessId", "createdAt");
CREATE INDEX IF NOT EXISTS "LineGroundingShadowComparison_accountId_createdAt_idx"
  ON public."LineGroundingShadowComparison"("accountId", "createdAt");

REVOKE ALL ON TABLE public."LineGroundingShadowComparison" FROM public, anon, authenticated;
ALTER TABLE public."LineGroundingShadowComparison" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LineGroundingShadowComparison" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineGroundingShadowComparison'
      AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON public."LineGroundingShadowComparison"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."LineGroundingShadowComparison" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE public."LineGroundingShadowComparison" IS
  'FR-277 — diagnostic-only shadow-compare rows for the ADR-090 Phase 3 grounding-mode switch (TASK-ZAI-095); never read by the customer-facing answer path.';

COMMIT;
