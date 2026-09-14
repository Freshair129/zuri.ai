-- @req FR-235 — a LINE OA account gains a publisher-set `knowledgeGrounding`
-- mode (ADR-090 D1): BUSINESS_KNOWLEDGE (default, every existing account —
-- unchanged behaviour), GKS_CORPUS or GKS_THEN_BUSINESS_KNOWLEDGE. Nothing
-- reads a corpus until a publisher switches an account's mode with the
-- CONFIGURE_KNOWLEDGE_GROUNDING action.
-- @spec SEC-032, SDD-099 — TEXT column, no CHECK constraint, following this
--   schema's own convention that enums are strings in the database and their
--   vocabulary lives once, in code (src/lib/validation/enums.js:
--   KNOWLEDGE_GROUNDING_MODES). The account service's zod schema
--   (zLineOaAccountAction) is the only writer and refuses any other value.
--
-- Additive only: one column with a default, `IF NOT EXISTS`, so this file is
-- idempotent and safe on a database where an operator already added it by
-- hand. Nothing existing is altered, renamed, dropped or rewritten; no grant
-- or policy changes, because LineOaAccount's RLS and grants already cover
-- every column of it.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057): dry run in a rolled-back transaction, then apply
-- and record the version.

BEGIN;

ALTER TABLE public."LineOaAccount" ADD COLUMN IF NOT EXISTS "knowledgeGrounding" TEXT NOT NULL DEFAULT 'BUSINESS_KNOWLEDGE';

COMMENT ON COLUMN public."LineOaAccount"."knowledgeGrounding" IS
  'FR-235 — BUSINESS_KNOWLEDGE (default) | GKS_CORPUS | GKS_THEN_BUSINESS_KNOWLEDGE (ADR-090 D1). Selects the knowledge.query reader a SERVER job''s answer uses: the curated zuri_core.business_knowledge table, the Business''s published GKS corpus generation, or the corpus with a traced, mode-gated fallback to the curated table on GKS_UNAVAILABLE or NO_EVIDENCE. A missing or unrecognised value is read as BUSINESS_KNOWLEDGE by application code (fail closed).';

COMMIT;
