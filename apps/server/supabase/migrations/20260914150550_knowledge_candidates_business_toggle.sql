-- @req FR-236 — Business gains `knowledgeCandidatesEnabled`: whether this
-- Business's viewers may draft LINE FAQ knowledge candidates at all
-- (ADR-090 D6). TASK-ZAI-099's success criterion: "candidates are off by
-- default per Business; when the owner turns them on for SmartGift, the
-- switch is recorded with its date and who asked." FR-236 shipped (PR #408)
-- without this switch — every Business could already draft/approve/reject
-- candidates through OWNER/LINE_OA_PUBLISHER authority alone, with no
-- per-Business gate. This column is that gate.
-- @spec ADR-090 D6; BR-002
-- @tested tests/unit/business-knowledge-candidates.test.js,
--   tests/integration/fr236-knowledge-candidates-business-toggle.test.js
--
-- Deliberately its OWN column, not a new key inside the existing
-- `capabilitiesJson` (20260907150000_business_capabilities.sql, FR-169).
-- `capabilitiesJson` answers "does this module apply to the Business at
-- all" and every existing capability there defaults ON, so an old Business
-- keeps exactly what it already had. This column answers a different,
-- narrower question — "may reviewed chat content be ADMITTED into the
-- knowledge corpus" — a content-safety gate, not a module-visibility gate,
-- so it defaults OFF for every Business, new or old, including ones that
-- already have the `knowledge` domain grant and already have OWNER /
-- LINE_OA_PUBLISHER members. Mixing the two into one JSON blob would let a
-- future generic capability read (or worse, a bulk capability copy) flip
-- this content-admission gate as a side effect of an unrelated toggle.
--
-- NOT NULL DEFAULT false set explicitly here, matching the Prisma default
-- (`@default(false)`) exactly — the application-level default is not relied
-- on alone (a sibling lane's lesson, 2026-09-14: a Prisma default with no
-- matching column default works locally and diverges in production).
--
-- Additive only: one column with a default, `IF NOT EXISTS`, so the file is
-- idempotent and safe on a database where an operator already added it by
-- hand. Nothing existing is altered, renamed, dropped or rewritten; no grant
-- or policy changes, because Business's RLS and grants already cover every
-- column of it (same shape as 20260907150000_business_capabilities.sql).
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version. Turning the
-- flag ON for SmartGift is a separate, later, explicitly-authorized write
-- through `business-knowledge-candidates-service.js`
-- (scripts/enable-smartgift-knowledge-candidates.mjs) — never a data patch
-- inside this migration.

BEGIN;

ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "knowledgeCandidatesEnabled" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "Business"."knowledgeCandidatesEnabled" IS
  'FR-236 — whether this Business may draft LINE FAQ knowledge candidates (ADR-090 D6). Off by default for every Business. Written only by business-knowledge-candidates-service.js (OWNER-only, versioned CAS, audited as BUSINESS/KNOWLEDGE_CANDIDATES_ENABLED_CHANGED); read by draftKnowledgeCandidate before any other authority check.';

COMMIT;
