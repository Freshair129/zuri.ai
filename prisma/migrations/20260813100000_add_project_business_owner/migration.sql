-- FR-043 / ADR-014: direct Business ownership with Space retained as context.
-- The local workflow uses `prisma db push`; this additive artifact documents
-- the Postgres/SQLite-compatible backfill for existing databases.
ALTER TABLE "Project" ADD COLUMN "businessId" TEXT;

UPDATE "Project"
SET "businessId" = (
  SELECT "businessId"
  FROM "Workspace"
  WHERE "Workspace"."id" = "Project"."workspaceId"
)
WHERE "businessId" IS NULL;

CREATE INDEX "Project_businessId_idx" ON "Project"("businessId");
