-- @req FR-001 — scope rows have archive state and version history.
-- @spec BR-001, ADR-018 — additive scope metadata; do not cascade or delete rows.
-- NOT APPLIED: the operator must apply this through the approved production
-- migration gate (ADR-057) before deploying code that reads the new columns.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

ALTER TABLE public."Portfolio"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE public."LegalEntity"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public."Branch"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

commit;
