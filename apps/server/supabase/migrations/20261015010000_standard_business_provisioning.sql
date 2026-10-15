-- @req FR-286 — versioned, grant-free standard Business snapshot and Space key.
-- @spec FR-074, FR-169, FR-191, FR-192 — scope and grant boundaries remain intact.
-- @tested tests/integration/business-provisioning-template.test.js
-- This source migration is not an instruction to apply it to production/Supabase.
BEGIN;

ALTER TABLE "Business"
  ADD COLUMN IF NOT EXISTS "provisioningTemplateId" TEXT,
  ADD COLUMN IF NOT EXISTS "provisioningTemplateVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "provisioningTemplateDigest" TEXT,
  ADD COLUMN IF NOT EXISTS "provisioningSnapshotJson" TEXT;

ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "provisioningKey" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Business_provisioning_markers_check'
      AND conrelid = '"Business"'::regclass
  ) THEN
    ALTER TABLE "Business"
      ADD CONSTRAINT "Business_provisioning_markers_check"
      CHECK (
        (
          "provisioningTemplateId" IS NULL AND
          "provisioningTemplateVersion" IS NULL AND
          "provisioningTemplateDigest" IS NULL AND
          "provisioningSnapshotJson" IS NULL
        ) OR (
          "provisioningTemplateId" IS NOT NULL AND
          "provisioningTemplateVersion" IS NOT NULL AND
          "provisioningTemplateDigest" IS NOT NULL AND
          "provisioningSnapshotJson" IS NOT NULL AND
          "provisioningTemplateId" = 'standard-business' AND
          "provisioningTemplateVersion" = '1.0.0' AND
          "provisioningTemplateDigest" ~ '^[0-9a-f]{64}$' AND
          jsonb_typeof("provisioningSnapshotJson"::jsonb) = 'object'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Workspace_provisioning_key_scope_check'
      AND conrelid = '"Workspace"'::regclass
  ) THEN
    ALTER TABLE "Workspace"
      ADD CONSTRAINT "Workspace_provisioning_key_scope_check"
      CHECK (
        "provisioningKey" IS NULL OR (
          "provisioningKey" = 'STANDARD_DEFAULT' AND
          "scopeType" = 'BUSINESS' AND
          "businessId" IS NOT NULL AND
          "tenantId" IS NOT NULL AND
          "portfolioId" IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_businessId_provisioningKey_key"
  ON "Workspace"("businessId", "provisioningKey");

COMMIT;
