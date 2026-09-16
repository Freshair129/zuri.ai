-- @req FR-169 — a Business gains `capabilitiesJson`, a feature-capability
-- store distinct from `Membership.domainKeysJson`: a grant says WHO may open a
-- module the Business already has, a capability says whether the module
-- applies to this Business AT ALL. The first consumer is `physicalStock`,
-- which the owner asked for directly: a service-only Business should be able
-- to hide the Warehouse slot (still `soon`, reserved under SCM since ADR-069)
-- from every menu, not merely see it disabled.
-- @spec BR-002 — the column is an attribute, never a key. ADR-069 — the
--   capability this column exists to serve.
-- @tested tests/unit/business-capabilities.test.js,
--   tests/integration/fr169-business-capability.test.js
--
-- Not-null with a default rather than nullable: `businessHasCapability()`
-- already treats a missing key inside the JSON as that capability's own
-- default, so the column itself never needs a NULL state to mean "unset" —
-- '{}' already means that, and every read goes through the same helper either
-- way. TEXT + application-level JSON, following this schema's stated
-- convention (enums.js: "enums are strings in the database") rather than a
-- native jsonb column, so it matches how every capability-shaped column in
-- this schema already reads (IntegrationProvider.capabilitiesJson).
--
-- Additive only: one column with a default, `IF NOT EXISTS`, so the file is
-- idempotent and safe on a database where an operator already added it by
-- hand. Nothing existing is altered, renamed, dropped or rewritten; no grant
-- or policy changes, because Business's RLS and grants already cover every
-- column of it.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057): dry run in a rolled-back transaction, then apply
-- and record the version.

BEGIN;

ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "capabilitiesJson" TEXT NOT NULL DEFAULT '{}';

COMMENT ON COLUMN "Business"."capabilitiesJson" IS
  'FR-169 — feature capabilities this Business has turned on, e.g. {"physicalStock": true}. Distinct from Membership.domainKeysJson (who may open a module); this says whether a module applies at all. Absent keys default per-capability in code (src/lib/business-capabilities.js), never here.';

COMMIT;
