-- @req FR-268, ADR-101 D1 — Business Key Results (OKR): a measurable child
-- of BusinessGoal, with append-only weekly check-ins. BusinessGoal gains
-- `perspective` (nullable Balanced Scorecard tag) and `isWig` (4DX flag,
-- default false, unused until FR-270/Phase 3).
--
-- No stored progress/status column on BusinessKeyResult: both are pure
-- functions of (baseline, target, direction, latest check-in), computed on
-- every read (SDD-107) — see project-manager/progress/key-result-progress.js.
-- BusinessGoal.progress becomes a write-through cache once a goal holds a
-- Key Result (BR-044); this migration does not touch existing progress
-- values — every current goal has zero Key Results and keeps its own.
--
-- Additive and idempotent. This migration is NOT APPLIED to production by
-- this change. Applying it is an owner-instructed operator step (ADR-057).

BEGIN;

ALTER TABLE "BusinessGoal" ADD COLUMN IF NOT EXISTS "perspective" TEXT;
ALTER TABLE "BusinessGoal" ADD COLUMN IF NOT EXISTS "isWig" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "BusinessKeyResult" (
  "id"            TEXT PRIMARY KEY,
  "businessId"    TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "goalId"        TEXT NOT NULL REFERENCES "BusinessGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "code"          TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "metric"        TEXT NOT NULL,
  "unit"          TEXT NOT NULL,
  "baseline"      DOUBLE PRECISION NOT NULL,
  "target"        DOUBLE PRECISION NOT NULL,
  "direction"     TEXT NOT NULL DEFAULT 'UP',
  "dueAt"         TIMESTAMP(3),
  "ownerPersonId" TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "confidence"    INTEGER NOT NULL DEFAULT 3,
  "status"        TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "BusinessKeyResultCheckIn" (
  "id"            TEXT PRIMARY KEY,
  "keyResultId"   TEXT NOT NULL REFERENCES "BusinessKeyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "weekStartAt"   TIMESTAMP(3) NOT NULL,
  "value"         DOUBLE PRECISION NOT NULL,
  "confidence"    INTEGER NOT NULL,
  "note"          TEXT,
  "source"        TEXT,
  "actorPersonId" TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessKeyResult_code_key" ON "BusinessKeyResult"("code");
CREATE INDEX IF NOT EXISTS "BusinessKeyResult_businessId_status_idx" ON "BusinessKeyResult"("businessId", "status");
CREATE INDEX IF NOT EXISTS "BusinessKeyResult_goalId_idx" ON "BusinessKeyResult"("goalId");

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessKeyResultCheckIn_keyResultId_weekStartAt_key" ON "BusinessKeyResultCheckIn"("keyResultId", "weekStartAt");
CREATE INDEX IF NOT EXISTS "BusinessKeyResultCheckIn_keyResultId_idx" ON "BusinessKeyResultCheckIn"("keyResultId");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['BusinessKeyResult', 'BusinessKeyResultCheckIn'] LOOP
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

COMMENT ON TABLE "BusinessKeyResult" IS 'FR-268, ADR-101 — a measurable child of BusinessGoal (OKR Key Result); no stored progress, computed from (baseline, target, direction, latest check-in) on every read (SDD-107). Not production-applied by this change.';
COMMENT ON TABLE "BusinessKeyResultCheckIn" IS 'FR-268 — append-only weekly check-in, one row per (keyResultId, weekStartAt). Write-through recomputes the parent BusinessGoal.progress in the same transaction (SDD-107, BR-044).';
COMMENT ON COLUMN "BusinessGoal"."perspective" IS 'ADR-101 D1 — nullable Balanced Scorecard tag (FR-269 shares the same four values on BusinessKpi). Null for every goal that predates FR-268.';
COMMENT ON COLUMN "BusinessGoal"."isWig" IS 'ADR-101 D1, FR-270 — 4DX Wildly Important Goal flag. Column exists from FR-268; the <=2-per-Business enforcement (BR-043) and its writer are FR-270/Phase 3. Always false until then.';
COMMENT ON COLUMN "BusinessKeyResult"."direction" IS 'UP or DOWN — see project-manager/progress/key-result-progress.js keyResultProgress(). Never NULL; defaults UP.';

COMMIT;
