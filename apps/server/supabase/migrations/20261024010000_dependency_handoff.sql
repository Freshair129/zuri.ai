-- FR-084: provider parity; no data rewrite or grant expansion.
ALTER TABLE public."Dependency" ADD COLUMN "contractJson" TEXT;
