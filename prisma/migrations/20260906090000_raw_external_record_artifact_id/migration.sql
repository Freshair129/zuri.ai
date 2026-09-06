-- @req FR-109, FR-081 — RawExternalRecord.artifactId (AC-109.3): the knowledge-
-- ingestion artifact id a raw payload was ingested as. Nullable, indexed, never
-- a key. The column reached prisma/schema.prisma on 2026-08-29 through
-- `prisma db push` with no migration in either tree; this file restores parity
-- with the local migration history, and its Supabase twin
-- (supabase/migrations/20260906090000_raw_external_record_artifact_id.sql) is
-- what production was missing.
-- @spec SDD-057, ADR-050 D4, BR-002
-- Additive: one nullable column and one index; nothing existing changes.

-- AlterTable
ALTER TABLE "RawExternalRecord" ADD COLUMN "artifactId" TEXT;

-- CreateIndex
CREATE INDEX "RawExternalRecord_artifactId_idx" ON "RawExternalRecord"("artifactId");
