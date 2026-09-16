-- @req FR-244 — declared business hours in Asia/Bangkok and a fixed out-of-hours
-- reply, per LINE OA account (ADR-094 D6 option A, TASK-ZAI-109).
-- @spec ADR-094 D6; ADR-057
-- @tested tests/unit/line-oa-business-hours-migration.test.js
--
-- Additive and idempotent: three nullable columns, no backfill needed — NULL on
-- all three is "no declared hours", the existing behaviour every account already
-- has (the model never sheds for it). A publisher opts an account in with
-- CONFIGURE_BUSINESS_HOURS, which the service writes as all three or none.
--
-- NOT APPLIED to production by this change — an owner-instructed operator step
-- (ADR-057).

BEGIN;

ALTER TABLE "LineOaAccount" ADD COLUMN IF NOT EXISTS "businessHoursOpen" TEXT;
ALTER TABLE "LineOaAccount" ADD COLUMN IF NOT EXISTS "businessHoursClose" TEXT;
ALTER TABLE "LineOaAccount" ADD COLUMN IF NOT EXISTS "outOfHoursReplyText" TEXT;

COMMENT ON COLUMN "LineOaAccount"."businessHoursOpen" IS 'FR-244 — "HH:MM" 24h Asia/Bangkok opening time; NULL means no declared hours (always resident).';
COMMENT ON COLUMN "LineOaAccount"."businessHoursClose" IS 'FR-244 — "HH:MM" 24h Asia/Bangkok closing time; set together with businessHoursOpen.';
COMMENT ON COLUMN "LineOaAccount"."outOfHoursReplyText" IS 'FR-244 — the fixed reply sent outside businessHoursOpen/Close, no model call.';

COMMIT;
