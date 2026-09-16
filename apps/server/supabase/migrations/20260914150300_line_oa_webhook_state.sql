-- @req FR-227 — a LINE OA account gains `webhookStateJson`: the computed
-- webhook health only LINE can report (endpoint, active flag, last test time,
-- reason, HTTP status). Written only by the REGISTER_WEBHOOK action
-- (line-oa-account-service.js); nothing else writes it and no other column is
-- read to answer "is our webhook set and working".
-- @spec SDD-097 planned-persistence table; ADR-089 D7; SEC-030 — the column
--   never carries a channel secret or access token, only LINE's own webhook
--   registration facts (endpoint URL, boolean, timestamps, short reason codes).
--
-- Additive only: one nullable column, no default, `IF NOT EXISTS`, so this
-- file is idempotent and safe on a database where an operator already added it
-- by hand. Nothing existing is altered, renamed, dropped or rewritten; no
-- grant or policy changes, because LineOaAccount's RLS and grants already
-- cover every column of it.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057): dry run in a rolled-back transaction, then apply
-- and record the version.

BEGIN;

ALTER TABLE public."LineOaAccount" ADD COLUMN IF NOT EXISTS "webhookStateJson" TEXT;

COMMENT ON COLUMN public."LineOaAccount"."webhookStateJson" IS
  'FR-227 — computed webhook health: JSON {endpoint, active, lastTestAt, lastTestReason, lastTestStatusCode}. Written only by the REGISTER_WEBHOOK action, from what LINE''s webhook set/get/test API reported. NULL until a publisher runs it at least once. Never a channel secret or access token (SEC-030).';

COMMIT;
