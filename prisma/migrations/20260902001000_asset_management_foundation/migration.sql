-- @req FR-133, FR-134, FR-135, FR-136
-- @spec SDD-078, SDD-079, SDD-080, BR-023, BR-024, SEC-023, ADR-055
-- Additive Asset Management foundation; no existing table or column is removed.

CREATE TABLE "RegisteredAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeId" TEXT,
    "lotId" TEXT,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "condition" TEXT NOT NULL DEFAULT 'GOOD',
    "acquisitionAmount" TEXT,
    "currency" TEXT,
    "receivedOn" DATETIME,
    "registeredAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "RegisteredAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RegisteredAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RegisteredAsset_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RegisteredAsset_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "AssetLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AssetIntake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeCode" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "sourceChannel" TEXT NOT NULL,
    "sourceCorrelationId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "pipelineRunId" TEXT,
    "submittedByPersonId" TEXT,
    "submittedAt" DATETIME,
    "approvedByPersonId" TEXT,
    "approvedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetIntake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetIntake_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AssetEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "registeredAssetId" TEXT,
    "fileAssetId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sha256" TEXT,
    "paymentReference" TEXT,
    "extractionJson" TEXT NOT NULL DEFAULT '{}',
    "reviewJson" TEXT NOT NULL DEFAULT '{}',
    "reviewedByPersonId" TEXT,
    "reviewedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetEvidence_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetEvidence_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssetEvidence_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AssetProcurementRef" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "registeredAssetId" TEXT,
    "type" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "lineValue" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetProcurementRef_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetProcurementRef_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AssetLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "manufacturedOn" DATETIME,
    "expiresOn" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetLot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AssetResponsibility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "registeredAssetId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "orgUnitSystem" TEXT,
    "orgUnitRef" TEXT,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "acknowledgedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetResponsibility_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetResponsibility_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AssetLocationHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "registeredAssetId" TEXT NOT NULL,
    "branchId" TEXT,
    "locationCode" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetLocationHistory_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetLocationHistory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AssetProjectAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "registeredAssetId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workstreamId" TEXT,
    "quantity" REAL NOT NULL DEFAULT 1,
    "exclusive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetProjectAllocation_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssetProjectAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetProjectAllocation_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AssetDepreciationCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeId" TEXT,
    "registeredAssetId" TEXT,
    "method" TEXT NOT NULL,
    "acquisitionAmount" TEXT NOT NULL,
    "residualValue" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "calculationVersion" TEXT NOT NULL,
    "scheduleJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "reviewedByPersonId" TEXT,
    "reviewedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "AssetDepreciationCandidate_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AssetDepreciationCandidate_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RegisteredAsset_intakeId_key" ON "RegisteredAsset"("intakeId");
CREATE INDEX "RegisteredAsset_tenantId_businessId_status_idx" ON "RegisteredAsset"("tenantId", "businessId", "status");
CREATE INDEX "RegisteredAsset_businessId_serialNumber_idx" ON "RegisteredAsset"("businessId", "serialNumber");
CREATE INDEX "RegisteredAsset_lotId_idx" ON "RegisteredAsset"("lotId");
CREATE UNIQUE INDEX "RegisteredAsset_businessId_assetCode_key" ON "RegisteredAsset"("businessId", "assetCode");
CREATE INDEX "AssetIntake_tenantId_businessId_status_idx" ON "AssetIntake"("tenantId", "businessId", "status");
CREATE INDEX "AssetIntake_pipelineRunId_idx" ON "AssetIntake"("pipelineRunId");
CREATE UNIQUE INDEX "AssetIntake_businessId_intakeCode_key" ON "AssetIntake"("businessId", "intakeCode");
CREATE UNIQUE INDEX "AssetIntake_businessId_sourceChannel_sourceCorrelationId_key" ON "AssetIntake"("businessId", "sourceChannel", "sourceCorrelationId");
CREATE INDEX "AssetEvidence_tenantId_businessId_status_idx" ON "AssetEvidence"("tenantId", "businessId", "status");
CREATE INDEX "AssetEvidence_registeredAssetId_idx" ON "AssetEvidence"("registeredAssetId");
CREATE INDEX "AssetEvidence_businessId_sha256_idx" ON "AssetEvidence"("businessId", "sha256");
CREATE INDEX "AssetEvidence_businessId_paymentReference_idx" ON "AssetEvidence"("businessId", "paymentReference");
CREATE UNIQUE INDEX "AssetEvidence_intakeId_fileAssetId_role_key" ON "AssetEvidence"("intakeId", "fileAssetId", "role");
CREATE INDEX "AssetProcurementRef_tenantId_businessId_type_idx" ON "AssetProcurementRef"("tenantId", "businessId", "type");
CREATE INDEX "AssetProcurementRef_registeredAssetId_idx" ON "AssetProcurementRef"("registeredAssetId");
CREATE UNIQUE INDEX "AssetProcurementRef_intakeId_type_system_value_lineValue_key" ON "AssetProcurementRef"("intakeId", "type", "system", "value", "lineValue");
CREATE INDEX "AssetLot_tenantId_businessId_expiresOn_idx" ON "AssetLot"("tenantId", "businessId", "expiresOn");
CREATE UNIQUE INDEX "AssetLot_businessId_lotCode_key" ON "AssetLot"("businessId", "lotCode");
CREATE INDEX "AssetResponsibility_tenantId_businessId_role_idx" ON "AssetResponsibility"("tenantId", "businessId", "role");
CREATE INDEX "AssetResponsibility_registeredAssetId_role_effectiveTo_idx" ON "AssetResponsibility"("registeredAssetId", "role", "effectiveTo");
CREATE INDEX "AssetResponsibility_personId_effectiveTo_idx" ON "AssetResponsibility"("personId", "effectiveTo");
CREATE INDEX "AssetLocationHistory_tenantId_businessId_effectiveTo_idx" ON "AssetLocationHistory"("tenantId", "businessId", "effectiveTo");
CREATE INDEX "AssetLocationHistory_registeredAssetId_isPrimary_effectiveTo_idx" ON "AssetLocationHistory"("registeredAssetId", "isPrimary", "effectiveTo");
CREATE INDEX "AssetLocationHistory_branchId_idx" ON "AssetLocationHistory"("branchId");
CREATE INDEX "AssetProjectAllocation_tenantId_businessId_status_idx" ON "AssetProjectAllocation"("tenantId", "businessId", "status");
CREATE INDEX "AssetProjectAllocation_registeredAssetId_exclusive_effectiveTo_idx" ON "AssetProjectAllocation"("registeredAssetId", "exclusive", "effectiveTo");
CREATE INDEX "AssetProjectAllocation_projectId_effectiveTo_idx" ON "AssetProjectAllocation"("projectId", "effectiveTo");
CREATE INDEX "AssetProjectAllocation_workstreamId_idx" ON "AssetProjectAllocation"("workstreamId");
CREATE INDEX "AssetDepreciationCandidate_tenantId_businessId_status_idx" ON "AssetDepreciationCandidate"("tenantId", "businessId", "status");
CREATE INDEX "AssetDepreciationCandidate_intakeId_idx" ON "AssetDepreciationCandidate"("intakeId");
CREATE INDEX "AssetDepreciationCandidate_registeredAssetId_idx" ON "AssetDepreciationCandidate"("registeredAssetId");
