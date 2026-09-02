-- @req FR-137, FR-138 — additive replay, normalized envelope and validation evidence.
-- @spec SDD-081, SDD-082, NFR-022, ADR-056
ALTER TABLE "AssetIntake" ADD COLUMN "payloadSha256" TEXT;
ALTER TABLE "AssetIntake" ADD COLUMN "normalizedEnvelopeJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "AssetIntake" ADD COLUMN "validationJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "AssetIntake" ADD COLUMN "validatedAt" DATETIME;

CREATE INDEX "AssetIntake_businessId_payloadSha256_idx"
ON "AssetIntake"("businessId", "payloadSha256");
