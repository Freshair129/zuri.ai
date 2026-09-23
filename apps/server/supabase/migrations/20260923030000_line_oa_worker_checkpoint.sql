-- @req FR-190 — durable scheduling checkpoint for the stateless LINE worker.
-- @spec ADR-105 D1/D3
-- Additive production migration. It is NOT APPLIED by this change; apply only
-- through the owner-approved migration runbook after dry-run and backup proof.

BEGIN;

CREATE TABLE IF NOT EXISTS public."LineOaWorkerCheckpoint" (
  "id" text PRIMARY KEY,
  "kind" text NOT NULL UNIQUE,
  "lastCompletedAt" timestamptz,
  "nextDueAt" timestamptz NOT NULL DEFAULT now(),
  "claimantId" text,
  "leaseExpiresAt" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "LineOaWorkerCheckpoint_kind_nextDueAt_leaseExpiresAt_idx"
  ON public."LineOaWorkerCheckpoint"("kind", "nextDueAt", "leaseExpiresAt");

REVOKE ALL ON TABLE public."LineOaWorkerCheckpoint" FROM public, anon, authenticated;
ALTER TABLE public."LineOaWorkerCheckpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LineOaWorkerCheckpoint" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LineOaWorkerCheckpoint'
      AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON public."LineOaWorkerCheckpoint"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public."LineOaWorkerCheckpoint" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE public."LineOaWorkerCheckpoint" IS
  'Operational checkpoints for stateless Zuri workers; expired leases are reclaimable and no provider secret is stored.';

COMMIT;
