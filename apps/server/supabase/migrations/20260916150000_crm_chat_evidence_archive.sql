-- @req FR-245 — the chat evidence cold archive's two owned tables (ADR-093 D4,
-- D6; SDD-103): the per-Customer archive data key, and the per-Tenant archive
-- manifest chain.
-- @spec SEC-034; ADR-093 D2, D4, D6; BR-002; ADR-057
-- @tested tests/unit/crm-chat-evidence-archive-crypto.test.js, tests/integration/crm-chat-evidence-archive.test.js
--
-- "CustomerArchiveKey" holds one row per Customer whose messages have ever been
-- archived: a per-Customer data key, sealed (AES-256-GCM) under this
-- deployment's ZURI_ARCHIVE_KEK — a secret distinct from ZURI_SECRET_KEK, so
-- compromising one secret store never opens the other. Same wrapped-DEK shape
-- as "IntegrationSecretEnvelope" (20260914140300), deliberately a dedicated row
-- per Customer rather than a key folded into every archive file: a future PDPA
-- erasure destroys exactly this row to make every line that Customer ever had
-- archived unreadable everywhere, without touching a single file on disk
-- (ADR-093 D6). Excluded from backup export by name (SNAPSHOT_EXCLUDED_MODELS),
-- same as the key-encryption material it wraps.
--
-- "ArchiveManifest" holds one row per archive file the sweep has written,
-- chained per Tenant: "previousManifestHash" copies the prior manifest's own
-- "manifestHash", and "manifestHash" is computed once at insert over this row's
-- own fields (including that copied value) and never recomputed — so verifying
-- the chain means recomputing every row's hash from its stored fields and
-- comparing, and a single tampered field anywhere breaks every hash after it.
-- A row is inserted only once its file has been written, flushed, read back and
-- its SHA-256 verified, in the same transaction that tombstones exactly the
-- messages it archived (ADR-093 D2) — so a row here always names a real, intact
-- file, never a failed or partial write. Excluded from backup export: a restore
-- recovers business data, not this evidence trail's own chain of custody, and
-- the files the chain points at are not part of any database snapshot either.
--
-- Neither table declares a foreign key to Tenant or Customer, deliberately —
-- the same choice "IntegrationSecretEnvelope" (20260914140300) already made
-- for the same reason. Both tables are excluded from every backup snapshot
-- (SNAPSHOT_EXCLUDED_MODELS), while Tenant and Customer are not: a real FK
-- here would make the snapshot restore's delete-then-reinsert of Tenant and
-- Customer fail on a row this table's own restore never runs to clear first.
-- "ArchiveManifest.previousManifestId" is the one exception — a real FK, but
-- only ever pointing at another row of this same excluded table, so it
-- participates in no cross-table restore ordering at all.
--
-- Additive and idempotent. NOT APPLIED to production by this change — an
-- owner-instructed operator step (ADR-057), after TASK-ZAI-114 wires the real
-- archive directory and ZURI_ARCHIVE_KEK on the production host.

BEGIN;

CREATE TABLE IF NOT EXISTS "CustomerArchiveKey" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "kekId"      TEXT NOT NULL,
  "wrappedDek" TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerArchiveKey_customerId_key" ON "CustomerArchiveKey"("customerId");
CREATE INDEX IF NOT EXISTS "CustomerArchiveKey_tenantId_idx" ON "CustomerArchiveKey"("tenantId");

ALTER TABLE "CustomerArchiveKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerArchiveKey" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'CustomerArchiveKey' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "CustomerArchiveKey" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "CustomerArchiveKey" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CustomerArchiveKey" TO zuri_app_runtime, zuri_web_login;

CREATE TABLE IF NOT EXISTS "ArchiveManifest" (
  "id"                   TEXT PRIMARY KEY,
  "tenantId"             TEXT NOT NULL,
  "runId"                TEXT NOT NULL,
  "filePath"             TEXT NOT NULL,
  "fileSha256"           TEXT NOT NULL,
  "messageCount"         INTEGER NOT NULL,
  "messageIdListHash"    TEXT NOT NULL,
  "previousManifestId"   TEXT,
  "previousManifestHash" TEXT,
  "manifestHash"         TEXT NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ArchiveManifest_tenantId_runId_key" ON "ArchiveManifest"("tenantId", "runId");
CREATE INDEX IF NOT EXISTS "ArchiveManifest_tenantId_createdAt_idx" ON "ArchiveManifest"("tenantId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ArchiveManifest_previousManifestId_fkey'
  ) THEN
    ALTER TABLE "ArchiveManifest"
      ADD CONSTRAINT "ArchiveManifest_previousManifestId_fkey"
      FOREIGN KEY ("previousManifestId") REFERENCES "ArchiveManifest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "ArchiveManifest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ArchiveManifest" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ArchiveManifest' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "ArchiveManifest" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "ArchiveManifest" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ArchiveManifest" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "CustomerArchiveKey" IS 'FR-245 — one per-Customer AES-256-GCM data key for the chat evidence archive, wrapped under ZURI_ARCHIVE_KEK (never ZURI_SECRET_KEK). Lazily created on first archive; destroying this row (a future PDPA erasure, unless a legal hold is recorded — TASK-ZAI-113) makes every archived line of that Customer permanently unreadable (SEC-034, ADR-093 D4, D6).';
COMMENT ON TABLE "ArchiveManifest" IS 'FR-245 — one row per archive file the retention sweep has written and verified, chained per Tenant by manifestHash/previousManifestHash (SDD-103, SEC-034, ADR-093 D2, D4). Inserted only in the same transaction that tombstones exactly the messages the file archived.';

COMMIT;
