-- @req FR-071 — provision the server-owned SmartGift document intake address
-- without creating a browser credential or publishing application tables via
-- the Supabase Data API.
-- @spec docs/domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md,
-- SEC-001, SEC-008
-- @tested tests/unit/smartgift-document-intake-migration.test.js

BEGIN;

-- One active primary document receiver per Business makes the read monitor's
-- businessId-only resolver deterministic. The existing application schema is
-- already RLS-enabled and server-owned; this migration does not grant Data API
-- access to anon/authenticated.
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationConnection_document_intake_active_primary_key"
  ON "IntegrationConnection" ("tenantId", "businessId", "purpose")
  WHERE "businessId" IS NOT NULL
    AND "purpose" = 'DATA_DOCUMENT_INGESTION'
    AND "status" = 'ACTIVE'
    AND "role" = 'PRIMARY';

INSERT INTO "IntegrationProvider" (
  "id", "code", "name", "status", "capabilitiesJson", "createdAt", "updatedAt", "version"
)
VALUES (
  '18f9b3c4-7d26-4a5e-9f80-1c2d3e4b5a67',
  'SMARTGIFT_DOCUMENT_INTAKE',
  'SmartGift Document Intake',
  'ACTIVE',
  '{"documentIntake":true,"thaiOcrVl":true,"canonicalWrite":false}',
  now(), now(), 1
)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name",
    "status" = 'ACTIVE',
    "capabilitiesJson" = EXCLUDED."capabilitiesJson",
    "updatedAt" = now();

-- The connection has no IntegrationCredential: local/Codex agents use the
-- trusted Zuri server boundary, not a second LLM/API key. The migration only
-- creates the approved staging receiver for the known SmartGift Business.
INSERT INTO "IntegrationConnection" (
  "id", "tenantId", "businessId", "providerId", "name", "authorizationType",
  "externalAccountId", "purpose", "role", "status", "metadataJson",
  "createdAt", "updatedAt", "version"
)
SELECT
  '29a0c4d5-8e37-4b6f-a091-2d3e4f5a6b78',
  b."tenantId",
  b."id",
  p."id",
  'SmartGift document intake',
  'TRUSTED_AGENT',
  NULL,
  'DATA_DOCUMENT_INGESTION',
  'PRIMARY',
  'ACTIVE',
  '{"contractVersion":"smartgift.document-intake.v1","sourceOfTruth":"supabase","backup":"duckdb","mode":"STAGING_ONLY"}',
  now(), now(), 1
FROM "Business" b
JOIN "IntegrationProvider" p ON p."code" = 'SMARTGIFT_DOCUMENT_INTAKE'
WHERE b."id" = '834fa869-62f3-431c-a287-e9a95e91175b'
  AND b."tenantId" = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  AND b."status" = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1
    FROM "IntegrationConnection" existing
    WHERE existing."businessId" = b."id"
      AND existing."providerId" = p."id"
      AND existing."purpose" = 'DATA_DOCUMENT_INGESTION'
  )
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "AuditEvent" (
  "id", "entityType", "entityId", "action", "payloadJson", "actorType", "actorId", "occurredAt"
)
SELECT
  '3ab1d5e6-9f48-4c70-b1a2-3e4f5a6b7c89',
  'INTEGRATION_CONNECTION',
  c."id",
  'DOCUMENT_INTAKE_CONNECTION_PROVISIONED',
  '{"contractVersion":"smartgift.document-intake.v1","provider":"SMARTGIFT_DOCUMENT_INTAKE","purpose":"DATA_DOCUMENT_INGESTION","canonicalWrite":false}',
  'MIGRATION',
  NULL,
  now()
FROM "IntegrationConnection" c
JOIN "IntegrationProvider" p ON p."id" = c."providerId"
WHERE c."id" = '29a0c4d5-8e37-4b6f-a091-2d3e4f5a6b78'
  AND p."code" = 'SMARTGIFT_DOCUMENT_INTAKE'
ON CONFLICT ("id") DO NOTHING;

DO $$
DECLARE
  total_connections integer;
  active_primary_connections integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Business"
    WHERE "id" = '834fa869-62f3-431c-a287-e9a95e91175b'
      AND "tenantId" = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SMARTGIFT_DOCUMENT_INTAKE_BUSINESS_MISSING';
  END IF;

  SELECT count(*) INTO total_connections
  FROM "IntegrationConnection" c
  JOIN "IntegrationProvider" p ON p."id" = c."providerId"
  WHERE c."businessId" = '834fa869-62f3-431c-a287-e9a95e91175b'
    AND p."code" = 'SMARTGIFT_DOCUMENT_INTAKE'
    AND c."purpose" = 'DATA_DOCUMENT_INGESTION';

  SELECT count(*) INTO active_primary_connections
  FROM "IntegrationConnection" c
  JOIN "IntegrationProvider" p ON p."id" = c."providerId"
  WHERE c."businessId" = '834fa869-62f3-431c-a287-e9a95e91175b'
    AND p."code" = 'SMARTGIFT_DOCUMENT_INTAKE'
    AND c."purpose" = 'DATA_DOCUMENT_INGESTION'
    AND c."status" = 'ACTIVE'
    AND c."role" = 'PRIMARY';

  IF total_connections <> 1 OR active_primary_connections <> 1 THEN
    RAISE EXCEPTION 'SMARTGIFT_DOCUMENT_INTAKE_CONNECTION_MISMATCH';
  END IF;
END $$;

COMMENT ON TABLE "IntegrationConnection" IS
  'Server-owned connection metadata. DATA_DOCUMENT_INGESTION is the SmartGift raw staging receiver; no browser secret or canonical write is implied.';

COMMIT;
