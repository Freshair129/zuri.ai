-- FR-084: additive legacy-null handoff; no satisfaction backfill.
ALTER TABLE "Dependency" ADD COLUMN "contractJson" TEXT;
