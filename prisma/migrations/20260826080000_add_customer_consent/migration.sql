-- FR-103 / SEC-005: PDPA per-tenant CRM-sharing consent on Customer. The local
-- workflow uses `prisma db push`; this additive artifact documents the
-- Postgres/SQLite-compatible backfill for existing databases (same pattern as
-- 20260813100000_add_project_business_owner).
--
-- Existing Customer rows predate this column and were already being served —
-- backfilling them to PENDING would retroactively cut off a live conversation
-- the moment anything starts enforcing consent, so they backfill to
-- GRANDFATHERED instead. Every Customer created from here on defaults to
-- PENDING and needs an explicit staff attestation (customer-consent-service).
ALTER TABLE "Customer" ADD COLUMN "consentStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Customer" ADD COLUMN "consentRecordedAt" DATETIME;
ALTER TABLE "Customer" ADD COLUMN "consentRecordedByPersonId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "consentNote" TEXT;

UPDATE "Customer" SET "consentStatus" = 'GRANDFATHERED' WHERE "consentStatus" = 'PENDING';

CREATE INDEX "Customer_consentStatus_idx" ON "Customer"("consentStatus");
