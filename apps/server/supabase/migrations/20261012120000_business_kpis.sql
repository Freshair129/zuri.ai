-- @req FR-269, ADR-101 D1 — Business-owned Balanced Scorecard KPIs and their
-- append-only manual observation history. Status is derived by application
-- code from target, warningThreshold, direction, and the latest observation.
--
-- Additive and idempotent. NOT APPLIED to production by this change; production
-- migration remains a separate operator/owner gate.

BEGIN;

CREATE TABLE IF NOT EXISTS "BusinessKpi" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "perspective" TEXT NOT NULL CHECK ("perspective" IN ('FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'LEARNING_GROWTH')),
  "unit" TEXT NOT NULL,
  "target" DOUBLE PRECISION NOT NULL,
  "warningThreshold" DOUBLE PRECISION NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'UP' CHECK ("direction" IN ('UP', 'DOWN')),
  "cadence" TEXT NOT NULL DEFAULT 'MONTHLY' CHECK ("cadence" IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY')),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "BusinessKpi_warningThreshold_check"
    CHECK (("direction" = 'UP' AND "warningThreshold" < "target") OR ("direction" = 'DOWN' AND "warningThreshold" > "target"))
);

CREATE TABLE IF NOT EXISTS "BusinessKpiObservation" (
  "id" TEXT PRIMARY KEY,
  "kpiId" TEXT NOT NULL REFERENCES "BusinessKpi"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "value" DOUBLE PRECISION NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "actorPersonId" TEXT REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "BusinessKpi_businessId_status_perspective_idx"
  ON "BusinessKpi"("businessId", "status", "perspective");
CREATE INDEX IF NOT EXISTS "BusinessKpiObservation_kpiId_observedAt_idx"
  ON "BusinessKpiObservation"("kpiId", "observedAt");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['BusinessKpi', 'BusinessKpiObservation'] LOOP
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

COMMENT ON TABLE "BusinessKpi" IS 'FR-269, ADR-101 D1 — a Business scorecard KPI. Current status is derived, never stored; the scorecard is separate from FR-060 composite health.';
COMMENT ON TABLE "BusinessKpiObservation" IS 'FR-269 — append-only manual KPI observations. Corrections are new rows; latest is selected deterministically by observedAt, createdAt, then id.';
COMMENT ON COLUMN "BusinessKpi"."warningThreshold" IS 'OWNER-defined boundary: combined with target and direction to derive WARN and BAD without a global percentage assumption.';

COMMIT;
