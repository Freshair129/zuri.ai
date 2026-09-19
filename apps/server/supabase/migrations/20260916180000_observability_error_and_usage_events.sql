-- @req FR-247 — ErrorEvent: a deduplicated, operator-readable error log.
-- fingerprint groups repeats of the same defect (name + message + first stack
-- frame); occurrenceCount/firstSeenAt/lastSeenAt track recurrence. stackFramesJson
-- holds parsed {file, line, function} frames only, never a raw stack string. No
-- personId — an error is a fact about the system, not about a person.
-- @req FR-248, FR-249 — UsageEvent: route- and action-level usage, per person
-- (ADR-095 D2, the owner's instruction over the aggregate-only default). kind is
-- PAGE_VIEW (route set) or ACTION (actionName set, always a static label).
-- @req NFR-023 — person-attributed UsageEvent rows are a 90-day window; the
-- rollup that survives past 90 days is a separate aggregate shape with no
-- personId, not a UsageEvent row edited in place. This migration creates no
-- rollup table because nothing has reached 90 days yet.
-- @spec ADR-095; ADR-057
--
-- Additive: two new tables, no change to an existing one. This migration is a
-- release artifact and is NOT APPLIED to production by this change. Applying is
-- an owner-instructed operator step (ADR-057), dry run first.

BEGIN;

CREATE TABLE IF NOT EXISTS "ErrorEvent" (
  "id" TEXT PRIMARY KEY,
  "fingerprint" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stackFramesJson" TEXT NOT NULL DEFAULT '[]',
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "correlationId" TEXT,
  "route" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByPersonId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "ErrorEvent_fingerprint_key" ON "ErrorEvent"("fingerprint");
CREATE INDEX IF NOT EXISTS "ErrorEvent_resolvedAt_lastSeenAt_idx" ON "ErrorEvent"("resolvedAt", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "ErrorEvent_lastSeenAt_idx" ON "ErrorEvent"("lastSeenAt");

CREATE TABLE IF NOT EXISTS "UsageEvent" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "route" TEXT,
  "actionName" TEXT,
  "personId" TEXT NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sessionId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "UsageEvent_personId_occurredAt_idx" ON "UsageEvent"("personId", "occurredAt");
CREATE INDEX IF NOT EXISTS "UsageEvent_kind_route_occurredAt_idx" ON "UsageEvent"("kind", "route", "occurredAt");
CREATE INDEX IF NOT EXISTS "UsageEvent_kind_actionName_occurredAt_idx" ON "UsageEvent"("kind", "actionName", "occurredAt");

ALTER TABLE "ErrorEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ErrorEvent" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ErrorEvent' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "ErrorEvent" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "ErrorEvent" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ErrorEvent" TO zuri_app_runtime, zuri_web_login;

ALTER TABLE "UsageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageEvent" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'UsageEvent' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "UsageEvent" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "UsageEvent" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "UsageEvent" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "ErrorEvent" IS 'FR-247 — deduplicated error log. fingerprint = sha256(name + message + first stack frame); occurrenceCount/lastSeenAt track recurrence; stackFramesJson holds parsed frames only. No personId (ADR-095 D1).';
COMMENT ON TABLE "UsageEvent" IS 'FR-248, FR-249 — route (PAGE_VIEW) and action (ACTION) usage, per person. 90-day raw retention, then an aggregate rollup with no personId (ADR-095 D2, D3).';

COMMIT;
