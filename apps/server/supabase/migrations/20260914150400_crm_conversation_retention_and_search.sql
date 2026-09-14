-- @req FR-230, FR-233 — the CRM-owned slice of design migration 5 and 8: the
-- read-model columns the earlier FR-229 migration explicitly deferred to this
-- change (Conversation.lastMessageAt/lastMessagePreview/retentionClass), the
-- pg_trgm search index over Message.body, and TenantRetentionOverride
-- (ADR-091 D2, D5).
-- @spec ADR-091 D2, D5; BR-002; SEC-031; ADR-057
-- @tested tests/unit/crm-conversation-retention-migration.test.js
--
-- Additive and idempotent: three new columns with defaults/nullable, one new
-- table, one GIN index. Every existing Conversation reads as
-- retentionClass='MESSAGE_BODY_AND_ATTACHMENTS' with a null last-message pair
-- until the next write refreshes it (conversation-preview-service.js runs a
-- backfill-by-use, not a data migration — no existing Conversation's true last
-- message is lost, only its denormalised copy is briefly stale until read).
--
-- NOT APPLIED to production by this change — an owner-instructed operator step
-- (ADR-057), dry run first. pg_trgm availability is confirmed by the operator
-- before this migration runs (TASK-ZAI-091).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastMessagePreview" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "retentionClass" TEXT NOT NULL DEFAULT 'MESSAGE_BODY_AND_ATTACHMENTS';

-- FR-233 — trigram search over Message.body. gin_trgm_ops accelerates the
-- `LIKE`/`ILIKE '%…%'` Prisma's `contains` already compiles to, so the reader
-- (conversation-search-service.js) needs no Postgres-specific query shape —
-- only this index is Postgres-specific.
CREATE INDEX IF NOT EXISTS "Message_body_trgm_idx" ON "Message" USING gin ("body" gin_trgm_ops);

CREATE TABLE IF NOT EXISTS "TenantRetentionOverride" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  "dataClass"  TEXT NOT NULL,
  "windowDays" INTEGER NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"    INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantRetentionOverride_tenantId_dataClass_key"
  ON "TenantRetentionOverride"("tenantId", "dataClass");
CREATE INDEX IF NOT EXISTS "TenantRetentionOverride_tenantId_idx" ON "TenantRetentionOverride"("tenantId");

-- schema.prisma declares onDelete: Cascade for TenantRetentionOverride.tenant;
-- same guarded pattern as MessageAttachment/ConversationEvent's constraints
-- (20260914150000) — SQLite's `prisma db push` gives tests the cascade for
-- free, so only an explicit constraint here gives production one too.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TenantRetentionOverride_tenantId_fkey'
  ) THEN
    ALTER TABLE "TenantRetentionOverride"
      ADD CONSTRAINT "TenantRetentionOverride_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "TenantRetentionOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantRetentionOverride" FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'TenantRetentionOverride' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "TenantRetentionOverride" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
  END IF;
END $$;
REVOKE ALL ON TABLE "TenantRetentionOverride" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TenantRetentionOverride" TO zuri_app_runtime, zuri_web_login;

COMMENT ON TABLE "TenantRetentionOverride" IS 'FR-230 — a Tenant''s per-data-class retention window, shortened only, never lengthened past the installation default (ADR-091 D2).';
COMMENT ON COLUMN "Conversation"."lastMessageAt" IS 'FR-233 — kept current by conversation-preview-service.js on every Message write.';
COMMENT ON COLUMN "Conversation"."lastMessagePreview" IS 'FR-233 — ≤120 chars, redacted by the same writer as Message.body (PDPA erasure, LINE unsend, the retention sweep).';
COMMENT ON COLUMN "Conversation"."retentionClass" IS 'FR-230 — which RETENTION_DATA_CLASSES entry governs this conversation''s messages.';

COMMIT;
