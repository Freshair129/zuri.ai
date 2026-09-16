-- @req SEC-034 — ADR-093 D6, TASK-ZAI-113: an OWNER-recorded legal hold defers
-- a Customer's chat evidence archive key destruction, and a column recording
-- when the expiry sweep deletes a fully-expired archive file.
-- @spec ADR-093 D5, D6; SEC-034
-- @tested tests/integration/crm-archive-legal-hold.test.js
--
-- "ArchiveLegalHold" holds one row per hold an OWNER has recorded on a
-- Customer's archive: a dispute reason and an end date. Rows accumulate
-- rather than one mutable row a later hold overwrites, so "does this Customer
-- currently have a hold" is answered by endDate > now over every row, not by
-- a single column a second dispute would silently replace. No foreign key to
-- Tenant/Customer/Person, the same choice "CustomerArchiveKey" and
-- "ArchiveManifest" (20260916150000) already made — but unlike those two,
-- this table IS included in the backup snapshot (SNAPSHOT_MODELS): a hold
-- that failed to survive a restore would leave a Customer's archive key
-- looking eligible for destruction when an OWNER had specifically protected
-- it.
--
-- "ArchiveManifest.fileDeletedAt" is set once the expiry sweep deletes a file
-- because every line in every segment it held has passed the archive's
-- retention term (ADR-093 D5). The manifest row itself is never deleted: it
-- stays the chain-of-custody record that the file existed, was verified at
-- write time, and was destroyed on schedule, not lost or corrupted.
--
-- Additive and idempotent. NOT APPLIED to production by this change — an
-- owner-instructed operator step (ADR-057), after TASK-ZAI-114 wires the real
-- archive directory and ZURI_ARCHIVE_KEK on the production host.

BEGIN;

ALTER TABLE "ArchiveManifest" ADD COLUMN IF NOT EXISTS "fileDeletedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ArchiveLegalHold" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "customerId"         TEXT NOT NULL,
  "reason"             TEXT NOT NULL,
  "endDate"            TIMESTAMP(3) NOT NULL,
  "recordedByPersonId" TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ArchiveLegalHold_tenantId_customerId_endDate_idx" ON "ArchiveLegalHold"("tenantId", "customerId", "endDate");

ALTER TABLE "ArchiveLegalHold" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ArchiveLegalHold" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ArchiveLegalHold' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "ArchiveLegalHold" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "ArchiveLegalHold" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ArchiveLegalHold" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "ArchiveLegalHold" IS 'SEC-034 — an OWNER-recorded legal hold on one Customer''s chat evidence archive: a dispute reason and an end date, deferring the archive key''s destruction on PDPA erasure or term expiry (ADR-093 D6, TASK-ZAI-113).';
COMMENT ON COLUMN "ArchiveManifest"."fileDeletedAt" IS 'SEC-034 — set when the expiry sweep deletes this file because every line in every segment expired (ADR-093 D5). The row itself is kept as the chain-of-custody record.';

COMMIT;
