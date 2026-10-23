-- @req FR-001 — scope rows have archive state and version history.
-- @spec BR-001 — additive scope metadata; do not cascade or delete rows.

ALTER TABLE "Portfolio" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "LegalEntity" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Branch" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
