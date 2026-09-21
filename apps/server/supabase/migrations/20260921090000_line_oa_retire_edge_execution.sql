-- @req FR-265 — retire EDGE execution from LINE OA Studio (ADR-100 D1, D6).
--
-- Two data normalisations and two comments. No column is dropped: narrowing a
-- vocabulary to one value and removing the column that held it are different
-- changes with different risk, and ADR-100 D6 keeps the columns so the rows that
-- once held EDGE stay readable.
--
-- `LineConversationJob.executionMode` is deliberately NOT rewritten. Its EDGE rows
-- are the ledger's record of how those turns actually ran; rewriting history to
-- match a current vocabulary is the one thing an evidence ledger must not do.
--
-- Additive and idempotent. This migration is NOT APPLIED to production by this
-- change. Applying it is an owner-instructed operator step (ADR-057): dry-run in a
-- rolled-back transaction, then apply and record the migration version.
--
-- Before applying, check what it will touch:
--   SELECT "transportMode", "executionMode", count(*)
--     FROM "LineOaAccount" GROUP BY 1, 2;
-- An account moved off EDGE transport keeps `serverEnabled` false — it was already
-- false for every EDGE row (the withdrawn SWITCH_TRANSPORT_MODE action set it so),
-- and this migration must not activate server ownership for anyone. Activation
-- stays an explicit, versioned owner action through ENABLE_SERVER.

BEGIN;

UPDATE "LineOaAccount" SET "transportMode" = 'CLOUD' WHERE "transportMode" <> 'CLOUD';
UPDATE "LineOaAccount" SET "executionMode" = 'SERVER' WHERE "executionMode" <> 'SERVER';

COMMENT ON COLUMN "LineOaAccount"."transportMode" IS
  'CLOUD only since FR-265 / ADR-100 D1. EDGE is retired; the column is kept so pre-ADR-100 rows stay readable and a future second transport owner finds the seam.';
COMMENT ON COLUMN "LineOaAccount"."executionMode" IS
  'SERVER only since FR-265 / ADR-100 D1. EDGE execution is withdrawn together with the /api/edge/conversation-jobs routes.';
COMMENT ON COLUMN "LineOaAccount"."modelAccess" IS
  'Retired by FR-265 / ADR-100 D3. LOCAL_ONLY never called a local model - it substituted a deterministic canned answerer - and every server answer now calls the provider under the Business own model key (FR-266). Written as EXTERNAL_MODEL_ALLOWED; nothing reads it.';
COMMENT ON COLUMN "LineConversationJob"."executionMode" IS
  'Historical evidence of how a turn ran. EDGE rows predate FR-265 / ADR-100 D2 and are deliberately not rewritten.';

COMMIT;
