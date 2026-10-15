-- @req FR-285 — one versioned standard agent configuration per Business.
-- This migration is source only; production/Supabase apply is not authorized.
BEGIN;

-- BusinessAgentConfig references this composite key. Ensure the source
-- migration also works against the pre-feature schema, before generated DDL.
CREATE UNIQUE INDEX IF NOT EXISTS "Business_id_tenantId_key"
  ON "Business"("id", "tenantId");

CREATE TABLE "BusinessAgentConfig" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "delegationPolicy" TEXT NOT NULL DEFAULT 'DENY',
  "snapshotJson" TEXT NOT NULL,
  "snapshotDigest" TEXT NOT NULL,
  "appliedByPersonId" TEXT NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BusinessAgentConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessAgentConfig_businessId_key" UNIQUE ("businessId"),
  CONSTRAINT "BusinessAgentConfig_businessId_tenantId_key" UNIQUE ("businessId", "tenantId"),
  CONSTRAINT "BusinessAgentConfig_versions_check" CHECK ("templateVersion" > 0 AND "version" > 0),
  CONSTRAINT "BusinessAgentConfig_delegationPolicy_check" CHECK ("delegationPolicy" = 'DENY'),
  CONSTRAINT "BusinessAgentConfig_snapshotDigest_check" CHECK ("snapshotDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "BusinessAgentConfig_businessId_tenantId_fkey"
    FOREIGN KEY ("businessId", "tenantId") REFERENCES "Business"("id", "tenantId")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BusinessAgentConfig_tenantId_idx" ON "BusinessAgentConfig"("tenantId");

COMMIT;
