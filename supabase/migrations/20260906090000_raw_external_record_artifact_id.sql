-- @req FR-109, FR-081 — the column AC-109.3 added to FR-081's RawExternalRecord
-- on 2026-08-29 (prisma/schema.prisma at ced1fba, PR #165) and never migrated:
-- `artifactId`, the id a knowledge-ingestion run carries as `artifactRef` /
-- `identityRefs.artifactIds`, resolving back to the raw payload it was built
-- from. Nullable — most raw records are never fed into knowledge ingestion —
-- and indexed, not unique: a caller that never sets it inserts many such rows.
-- @spec SDD-057, ADR-050 D4 — FR-081's own model gains a column; the knowledge
--   domain owns no model. BR-002 — the artifact id is an attribute, never a key.
-- @tested tests/unit/schema-migration-drift.test.js (the guard that now fails
--   when a declared column has no migration), tests/integration/platform/
--   integration-persistence.test.js (the column's behaviour)
--
-- Why this file exists seven days after the column: the dev database is SQLite
-- under `prisma db push`, so the column appeared locally with no migration and
-- every test passed. Production Supabase is migrated only from this directory,
-- and nothing here added it — so `GET /api/backup/export`, which selects every
-- column of every snapshot model, failed on production from 2026-08-29 with
-- "The column RawExternalRecord.artifactId does not exist"
-- (.brain/rca/2026-09-06-a-schema-column-with-no-migration.md).
--
-- Additive only: one nullable column and one index, both `IF NOT EXISTS`, so
-- the file is idempotent and safe on a database where an operator already
-- added either by hand. Nothing existing is altered, renamed, dropped or
-- rewritten; no grant or policy changes, because the table's RLS and grants
-- already cover every column of it.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057): coordinate with the deploy-role session and use the
-- same procedure as docs/runbooks/line-oa-provider-merge.md §4 (dry run in a
-- rolled-back transaction, then apply and record the version).

BEGIN;

ALTER TABLE "RawExternalRecord" ADD COLUMN IF NOT EXISTS "artifactId" TEXT;

CREATE INDEX IF NOT EXISTS "RawExternalRecord_artifactId_idx" ON "RawExternalRecord"("artifactId");

COMMENT ON COLUMN "RawExternalRecord"."artifactId" IS
  'FR-109 AC-109.3 — knowledge-ingestion artifact id this raw payload was ingested as; nullable, indexed, never a key (BR-002).';

COMMIT;
