-- @req SEC-034 — the legal hold that defers chat evidence archive key
-- destruction (ADR-093 D6, TASK-ZAI-113): an OWNER-recorded dispute, its
-- reason and an end date. While an unexpired hold exists for a Customer,
-- `destroyCustomerArchiveKey` (chat-evidence-archive-service.js) refuses to
-- delete their `CustomerArchiveKey` row from either the PDPA-erasure path
-- (erase-principal.js) or the 10-year expiry path
-- (chat-evidence-archive-expiry-service.js).
-- @spec ADR-093 D6; SEC-034; BR-001
-- @tested tests/integration/crm-archive-legal-hold.test.js
--
-- Unlike "CustomerArchiveKey" and "ArchiveManifest" (20260916150000), this
-- table holds no key and no file reference — a free-text dispute reason and
-- an end date, the same shape as an ordinary CRM record — so it takes real
-- foreign keys to Tenant, Customer and the recording Person, and is included
-- in the backup snapshot (SNAPSHOT_MODELS, backup-service.js) like any other
-- Customer child row.
--
-- Rows are inserted only, never updated: "active" is derived (`now <
-- endDate`) wherever it is read, so a Customer accumulating more than one
-- hold over time (sequential disputes) is additive history, not a row this
-- migration or the application ever mutates in place. There is no code path
-- that ends a hold early — ADR-093 D6 describes only recording one with a
-- reason and an end date.
--
-- Additive and idempotent. NOT APPLIED to production by this change — an
-- owner-instructed operator step (ADR-057), same as 20260916150000 before it.

BEGIN;

CREATE TABLE IF NOT EXISTS "CustomerLegalHold" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "customerId"         TEXT NOT NULL,
  "reason"             TEXT NOT NULL,
  "endDate"            TIMESTAMP(3) NOT NULL,
  "recordedByPersonId" TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "CustomerLegalHold_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerLegalHold_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerLegalHold_recordedByPersonId_fkey"
    FOREIGN KEY ("recordedByPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CustomerLegalHold_tenantId_idx" ON "CustomerLegalHold"("tenantId");
CREATE INDEX IF NOT EXISTS "CustomerLegalHold_customerId_endDate_idx" ON "CustomerLegalHold"("customerId", "endDate");

ALTER TABLE "CustomerLegalHold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerLegalHold" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'CustomerLegalHold' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "CustomerLegalHold" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "CustomerLegalHold" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CustomerLegalHold" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "CustomerLegalHold" IS 'SEC-034 — an OWNER-recorded legal hold on a Customer''s chat evidence archive (ADR-093 D6, TASK-ZAI-113): a dispute reason and an end date. Rows are appended, never updated; "active" is derived (now < endDate). While an active hold exists, destroyCustomerArchiveKey refuses to delete that Customer''s CustomerArchiveKey row from either the PDPA-erasure or the 10-year-expiry path.';

COMMIT;
