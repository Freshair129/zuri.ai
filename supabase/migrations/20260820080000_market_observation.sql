-- @req FR-092 — persist the first provider-neutral translated Market state.
-- @spec NFR-018, BR-019, SDD-049, SEC-017, ADR-038
-- @tested tests/unit/market-intelligence-schema-migration.test.js
--
-- Additive production migration for the application schema. RawExternalRecord
-- remains Integration-owned; the scalar rawRecordId is lineage, not a writable
-- Prisma relation. The table may already exist from the Prisma production lane,
-- so the reconciliation path is intentionally idempotent.

CREATE TABLE IF NOT EXISTS "MarketObservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "rawRecordId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourcePayloadHash" TEXT NOT NULL,
    "sourceUri" TEXT,
    "translationSchemaVersion" TEXT NOT NULL,
    "observationType" TEXT NOT NULL,
    "candidateJson" TEXT NOT NULL,
    "canonicalProductRef" TEXT,
    "canonicalCategoryRef" TEXT,
    "resolutionStatus" TEXT NOT NULL,
    "resolutionConfidence" DOUBLE PRECISION,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "translatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineageKey" TEXT NOT NULL,

    CONSTRAINT "MarketObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketObservation_lineageKey_key" ON "MarketObservation"("lineageKey");
CREATE INDEX IF NOT EXISTS "MarketObservation_tenantId_businessId_observedAt_idx" ON "MarketObservation"("tenantId", "businessId", "observedAt");
CREATE INDEX IF NOT EXISTS "MarketObservation_tenantId_connectionId_provider_idx" ON "MarketObservation"("tenantId", "connectionId", "provider");
CREATE INDEX IF NOT EXISTS "MarketObservation_rawRecordId_idx" ON "MarketObservation"("rawRecordId");
CREATE INDEX IF NOT EXISTS "MarketObservation_canonicalProductRef_idx" ON "MarketObservation"("canonicalProductRef");

ALTER TABLE "MarketObservation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MarketObservation" FROM anon, authenticated;
