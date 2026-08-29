-- @req FR-122 — a Profile states who the person is, not just what to call them:
-- given name, family name and telephone number, collected at FR-066's Profile
-- step over the display name it already took.
-- @spec FR-066, BR-016
-- @tested tests/unit/profile-identity-fields-migration.test.js
--
-- Nullable is a constraint here, not a preference. `Person` rows already exist
-- that can never satisfy these columns — `prisma/seed.js`, FR-107's operator
-- bootstrap, and above all every Person FR-023's LINE ingest creates on first
-- contact from a `lineUserId`, which carries a channel subject and nothing
-- else. A NOT NULL would make that intake path unwritable and take the primary
-- surface down with it. The requirement is enforced at the profile boundary
-- (`completeProfile`), the only place a person states these things themselves.
--
-- Additive and nullable, so this is safe on a live database: Postgres adds a
-- nullable column by updating the catalogue, without rewriting the table. No
-- backfill, and no grant changes — `Person` already carries its RLS policy and
-- role grants from 20260822204604_canonical_iam_runtime_role_cutover.sql, and
-- column additions inherit them.
--
-- `IF NOT EXISTS` so re-application is a no-op: this lineage is applied by hand,
-- and its ledger row is written separately — never from inside this file.

BEGIN;

ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "phone" TEXT;

COMMENT ON COLUMN "Person"."firstName" IS
  'FR-122 — given name, required at FR-066''s profile step and nullable here: Person rows created by LINE ingest (FR-023) have no name to give.';
COMMENT ON COLUMN "Person"."lastName" IS
  'FR-122 — family name, same nullability reasoning as "firstName".';
COMMENT ON COLUMN "Person"."phone" IS
  'FR-122 — telephone number, stated by the person at the profile step. No format validation: this installation has no SMS transport and no country it can assume.';

COMMIT;
