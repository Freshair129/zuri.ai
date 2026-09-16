-- @req FR-249, NFR-023 — UsageEventRollup: the daily, person-free aggregate a
-- UsageEvent row over 90 days old becomes. `target` is the route (PAGE_VIEW) or
-- actionName (ACTION), never null — a nullable column in the unique constraint
-- would let Postgres treat two NULLs as distinct and defeat the upsert this
-- table exists for.
-- @spec ADR-095 D3
--
-- Additive: one new table, no change to an existing one. This migration is a
-- release artifact and is NOT APPLIED to production by this change. Applying is
-- an owner-instructed operator step (ADR-057), dry run first.

BEGIN;

CREATE TABLE IF NOT EXISTS "UsageEventRollup" (
  "id" TEXT PRIMARY KEY,
  "date" TIMESTAMP(3) NOT NULL,
  "kind" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "UsageEventRollup_date_kind_target_key" ON "UsageEventRollup"("date", "kind", "target");

ALTER TABLE "UsageEventRollup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageEventRollup" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'UsageEventRollup' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "UsageEventRollup" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "UsageEventRollup" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "UsageEventRollup" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "UsageEventRollup" IS 'FR-249, NFR-023 — daily, person-free aggregate of UsageEvent rows past their 90-day raw window. target = route or actionName, never null (ADR-095 D3).';

COMMIT;
