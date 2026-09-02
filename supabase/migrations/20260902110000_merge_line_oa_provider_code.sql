-- @req FR-080 — merge the legacy lowercase `line-oa` IntegrationProvider
-- identity into the canonical `LINE_OA` one, so BR-002 ("external ids are
-- never primary keys, and a provider has exactly one identity") holds for
-- rows written before the shared-constant fix landed.
-- @spec BR-002, SEC-016, ADR-032
-- @tested tests/integration/line-oa-provider-migration.test.js
--
-- Idempotent and safe to run more than once: every step is a conditional
-- INSERT/UPDATE/DELETE, not a one-shot rename. Mirrors, for the Postgres
-- database, the same logic scripts/migrate-line-oa-provider.mjs runs through
-- Prisma against the SQLite dev database. See
-- docs/runbooks/line-oa-provider-merge.md for the apply procedure and the
-- verification query.
--
-- `"IntegrationConnection"` has no CHECK constraint on `"status"` or
-- `"metadataJson"` in this schema (see 20260818084011_application_schema.sql)
-- — both are plain TEXT columns, enums enforced only in application code
-- (src/lib/validation/enums.js) — so DISABLED and a merged JSON object are
-- both ordinary writes here, not a schema change.

BEGIN;

-- Step 1 — the canonical provider row, present whether or not any legacy
-- row exists to merge (mirrors ensureLineProvider() in
-- src/modules/integration/application/line-registry-service.js).
INSERT INTO "IntegrationProvider" ("id", "code", "name", "status", "capabilitiesJson", "createdAt", "updatedAt", "version")
SELECT '5f6a1b2c-8d3e-4f10-9a21-3b4c5d6e7f80', 'LINE_OA', 'LINE Official Account', 'ACTIVE', '{}', now(), now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "IntegrationProvider" WHERE "code" = 'LINE_OA');

-- Step 2 — a legacy connection collides with a canonical one when they share
-- (tenantId, externalAccountId): the exact granularity of
-- `@@unique([tenantId, providerId, externalAccountId])`, which is what would
-- be violated by pointing both rows at the same providerId. NULL
-- externalAccountId never collides (NULL is distinct from NULL under the
-- unique index), so only NOT NULL matches are considered. The legacy
-- duplicate is disabled rather than deleted — it stays as the historical
-- record of the merge, and its own metadata is preserved alongside the new
-- fields (never overwritten). Guarded by the reason tag so a second run does
-- not re-append it.
UPDATE "IntegrationConnection" legacy
SET "status" = 'DISABLED',
    "metadataJson" = (
      COALESCE(NULLIF(legacy."metadataJson", '')::jsonb, '{}'::jsonb)
      || jsonb_build_object('mergedInto', canonical_conn."id", 'reason', 'LINE_OA_PROVIDER_MERGE')
    )::text,
    "updatedAt" = now()
FROM "IntegrationProvider" legacy_provider
JOIN "IntegrationProvider" canonical_provider ON canonical_provider."code" = 'LINE_OA'
JOIN "IntegrationConnection" canonical_conn
  ON canonical_conn."providerId" = canonical_provider."id"
 AND canonical_conn."tenantId" = legacy."tenantId"
 AND canonical_conn."externalAccountId" IS NOT NULL
 AND canonical_conn."externalAccountId" = legacy."externalAccountId"
WHERE legacy."providerId" = legacy_provider."id"
  AND legacy_provider."code" = 'line-oa'
  AND (NULLIF(legacy."metadataJson", '')::jsonb ->> 'reason') IS DISTINCT FROM 'LINE_OA_PROVIDER_MERGE';

-- Step 3 — every remaining legacy connection (none of these matched a
-- canonical row in Step 2, by construction) moves to the canonical provider.
-- Re-evaluates the same collision predicate directly rather than relying on
-- Step 2's ordering, so this statement alone is idempotent regardless of what
-- ran before it.
UPDATE "IntegrationConnection" legacy
SET "providerId" = canonical_provider."id",
    "updatedAt" = now()
FROM "IntegrationProvider" legacy_provider, "IntegrationProvider" canonical_provider
WHERE legacy."providerId" = legacy_provider."id"
  AND legacy_provider."code" = 'line-oa'
  AND canonical_provider."code" = 'LINE_OA'
  AND NOT EXISTS (
    SELECT 1 FROM "IntegrationConnection" existing
    WHERE existing."providerId" = canonical_provider."id"
      AND existing."tenantId" = legacy."tenantId"
      AND existing."externalAccountId" IS NOT NULL
      AND existing."externalAccountId" = legacy."externalAccountId"
  );

-- Step 4 — the legacy provider row is deleted only once nothing references it
-- any more. A disabled duplicate from Step 2 still does, on purpose, so the
-- legacy code survives exactly as long as its last historical row does.
DELETE FROM "IntegrationProvider" p
WHERE p."code" = 'line-oa'
  AND NOT EXISTS (SELECT 1 FROM "IntegrationConnection" c WHERE c."providerId" = p."id");

COMMENT ON TABLE "IntegrationProvider" IS
  'Provider identity is addressed by code (BR-002); LINE_OA is canonical, the legacy lowercase line-oa code is retired by this migration once no connection still references it.';

COMMIT;
