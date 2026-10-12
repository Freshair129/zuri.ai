-- @req FR-270, ADR-101 D1/D5 — 4DX lead measures, weekly commitments,
-- WIG sessions, and the Key Result lag-measure marker.
-- Additive and idempotent. NOT APPLIED to production by this change; production
-- migration remains a separate operator/owner gate.

BEGIN;

ALTER TABLE "BusinessKeyResult"
  ADD COLUMN IF NOT EXISTS "isLagMeasure" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "BusinessLeadMeasure" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "goalId" TEXT NOT NULL REFERENCES "BusinessGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "weeklyTarget" DOUBLE PRECISION NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'UP',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "BusinessLeadMeasureValue" (
  "id" TEXT PRIMARY KEY,
  "leadMeasureId" TEXT NOT NULL REFERENCES "BusinessLeadMeasure"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "weekStartAt" TIMESTAMP(3) NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "actorPersonId" TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "BusinessWeeklyCommitment" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "weekStartAt" TIMESTAMP(3) NOT NULL,
  "ownerPersonId" TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "leadMeasureId" TEXT REFERENCES "BusinessLeadMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "BusinessWigSession" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "weekStartAt" TIMESTAMP(3) NOT NULL,
  "reportCompletedAt" TIMESTAMP(3),
  "scoreboardCompletedAt" TIMESTAMP(3),
  "planCompletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "BusinessWigSession_businessId_weekStartAt_key" UNIQUE ("businessId", "weekStartAt")
);

CREATE INDEX IF NOT EXISTS "BusinessLeadMeasure_businessId_status_idx" ON "BusinessLeadMeasure"("businessId", "status");
CREATE INDEX IF NOT EXISTS "BusinessLeadMeasure_goalId_status_idx" ON "BusinessLeadMeasure"("goalId", "status");
CREATE INDEX IF NOT EXISTS "BusinessLeadMeasureValue_leadMeasureId_weekStartAt_createdAt_idx" ON "BusinessLeadMeasureValue"("leadMeasureId", "weekStartAt", "createdAt");
CREATE INDEX IF NOT EXISTS "BusinessWeeklyCommitment_businessId_weekStartAt_done_idx" ON "BusinessWeeklyCommitment"("businessId", "weekStartAt", "done");
CREATE INDEX IF NOT EXISTS "BusinessWeeklyCommitment_ownerPersonId_weekStartAt_idx" ON "BusinessWeeklyCommitment"("ownerPersonId", "weekStartAt");
CREATE INDEX IF NOT EXISTS "BusinessWeeklyCommitment_leadMeasureId_idx" ON "BusinessWeeklyCommitment"("leadMeasureId");
CREATE INDEX IF NOT EXISTS "BusinessWigSession_businessId_weekStartAt_idx" ON "BusinessWigSession"("businessId", "weekStartAt");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['BusinessLeadMeasure', 'BusinessLeadMeasureValue', 'BusinessWeeklyCommitment', 'BusinessWigSession'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format('CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I FROM public, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO zuri_app_runtime, zuri_web_login', t);
  END LOOP;
END $$;

COMMENT ON COLUMN "BusinessKeyResult"."isLagMeasure" IS 'FR-270, ADR-101 D5 — true only for the one selected lag Key Result of a WIG goal.';
COMMENT ON TABLE "BusinessLeadMeasure" IS 'FR-270 — weekly-target metric directly controlled by the team, scoped to a Business WIG.';
COMMENT ON TABLE "BusinessLeadMeasureValue" IS 'FR-270 — append-only cumulative weekly snapshots; corrections are additional rows.';
COMMENT ON TABLE "BusinessWeeklyCommitment" IS 'FR-270 — OWNER-recorded weekly commitment for a named Business Person.';
COMMENT ON TABLE "BusinessWigSession" IS 'FR-270 — one report/scoreboard/plan session per Business and Bangkok week.';

COMMIT;
