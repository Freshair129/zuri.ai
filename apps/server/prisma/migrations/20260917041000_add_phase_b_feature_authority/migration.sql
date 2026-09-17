-- @req FR-252 — Phase B Feature authority persistence for the offline SQLite
-- adapter. This is the local twin of the Supabase migration with the same
-- six records, restrictive parent FKs, bounds, immutable evidence fields and
-- unconditional keys (including tombstones).
-- @spec ADR-097; docs/architecture/project-manager-system/25-PHASE-B-PERSISTENCE-SECURITY-POLICY.md
-- @tested tests/unit/phase-b-feature-migration.test.js
--
-- Additive only. The application must resolve the complete Project hierarchy,
-- acquire BEGIN IMMEDIATE and perform the remaining cross-row checks before
-- writing. SQLite has no equivalent to PostgreSQL transaction-local RLS.

PRAGMA foreign_keys=ON;

-- Restore order 1: immutable verified repository evidence.
CREATE TABLE "GovernanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repositoryId" TEXT NOT NULL,
    "projectRepositoryId" TEXT NOT NULL,
    "checkoutBindingId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "verifiedAt" DATETIME NOT NULL,
    "verifierId" TEXT NOT NULL,
    "verifierVersion" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "verificationProof" TEXT NOT NULL,
    "validationStatus" TEXT NOT NULL,
    "sourceManifest" TEXT NOT NULL,
    CONSTRAINT "GovernanceSnapshot_id_uuid_check" CHECK (
      length("id") = 36 AND length(replace("id", '-', '')) = 32 AND substr("id", 9, 1) = '-' AND
      substr("id", 14, 1) = '-' AND substr("id", 19, 1) = '-' AND
      substr("id", 24, 1) = '-' AND "id" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "GovernanceSnapshot_tenantId_uuid_check" CHECK (
      length("tenantId") = 36 AND length(replace("tenantId", '-', '')) = 32 AND substr("tenantId", 9, 1) = '-' AND
      substr("tenantId", 14, 1) = '-' AND substr("tenantId", 19, 1) = '-' AND
      substr("tenantId", 24, 1) = '-' AND "tenantId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "GovernanceSnapshot_businessId_uuid_check" CHECK (
      length("businessId") = 36 AND length(replace("businessId", '-', '')) = 32 AND substr("businessId", 9, 1) = '-' AND
      substr("businessId", 14, 1) = '-' AND substr("businessId", 19, 1) = '-' AND
      substr("businessId", 24, 1) = '-' AND "businessId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "GovernanceSnapshot_repositoryId_uuid_check" CHECK (
      length("repositoryId") = 36 AND length(replace("repositoryId", '-', '')) = 32 AND substr("repositoryId", 9, 1) = '-' AND
      substr("repositoryId", 14, 1) = '-' AND substr("repositoryId", 19, 1) = '-' AND
      substr("repositoryId", 24, 1) = '-' AND "repositoryId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "GovernanceSnapshot_projectRepositoryId_uuid_check" CHECK (
      length("projectRepositoryId") = 36 AND length(replace("projectRepositoryId", '-', '')) = 32 AND substr("projectRepositoryId", 9, 1) = '-' AND
      substr("projectRepositoryId", 14, 1) = '-' AND substr("projectRepositoryId", 19, 1) = '-' AND
      substr("projectRepositoryId", 24, 1) = '-' AND "projectRepositoryId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "GovernanceSnapshot_proofId_uuid_check" CHECK (
      length("proofId") = 36 AND length(replace("proofId", '-', '')) = 32 AND substr("proofId", 9, 1) = '-' AND
      substr("proofId", 14, 1) = '-' AND substr("proofId", 19, 1) = '-' AND
      substr("proofId", 24, 1) = '-' AND "proofId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "GovernanceSnapshot_checkoutBindingId_bounds" CHECK (
      length("checkoutBindingId") BETWEEN 1 AND 256
    ),
    CONSTRAINT "GovernanceSnapshot_commitSha_bounds" CHECK (
      length("commitSha") IN (40, 64) AND
      "commitSha" NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "GovernanceSnapshot_manifestHash_sha256" CHECK (
      length("manifestHash") = 64 AND
      "manifestHash" NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "GovernanceSnapshot_verifierId_bounds" CHECK (
      length("verifierId") BETWEEN 1 AND 128
    ),
    CONSTRAINT "GovernanceSnapshot_verifierVersion_bounds" CHECK (
      length("verifierVersion") BETWEEN 1 AND 64
    ),
    CONSTRAINT "GovernanceSnapshot_validationStatus_check" CHECK (
      "validationStatus" = 'VALID'
    ),
    CONSTRAINT "GovernanceSnapshot_sourceManifest_bounds" CHECK (
      length(CAST("sourceManifest" AS BLOB)) BETWEEN 1 AND 1048576
    ),
    CONSTRAINT "GovernanceSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId")
      REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GovernanceSnapshot_businessId_fkey" FOREIGN KEY ("businessId")
      REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GovernanceSnapshot_repositoryId_fkey" FOREIGN KEY ("repositoryId")
      REFERENCES "Repository" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GovernanceSnapshot_projectRepositoryId_fkey" FOREIGN KEY ("projectRepositoryId")
      REFERENCES "ProjectRepository" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Restore order 2: Project-local Feature authority.
CREATE TABLE "ProjectFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "primaryDomainId" TEXT NOT NULL,
    "canonicalFeatureKey" TEXT,
    "governanceSnapshotId" TEXT,
    "lifecycle" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "deleteBatchId" TEXT,
    CONSTRAINT "ProjectFeature_id_uuid_check" CHECK (
      length("id") = 36 AND length(replace("id", '-', '')) = 32 AND substr("id", 9, 1) = '-' AND
      substr("id", 14, 1) = '-' AND substr("id", 19, 1) = '-' AND
      substr("id", 24, 1) = '-' AND "id" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "ProjectFeature_tenantId_uuid_check" CHECK (
      length("tenantId") = 36 AND length(replace("tenantId", '-', '')) = 32 AND substr("tenantId", 9, 1) = '-' AND
      substr("tenantId", 14, 1) = '-' AND substr("tenantId", 19, 1) = '-' AND
      substr("tenantId", 24, 1) = '-' AND "tenantId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "ProjectFeature_businessId_uuid_check" CHECK (
      length("businessId") = 36 AND length(replace("businessId", '-', '')) = 32 AND substr("businessId", 9, 1) = '-' AND
      substr("businessId", 14, 1) = '-' AND substr("businessId", 19, 1) = '-' AND
      substr("businessId", 24, 1) = '-' AND "businessId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "ProjectFeature_projectId_uuid_check" CHECK (
      length("projectId") = 36 AND length(replace("projectId", '-', '')) = 32 AND substr("projectId", 9, 1) = '-' AND
      substr("projectId", 14, 1) = '-' AND substr("projectId", 19, 1) = '-' AND
      substr("projectId", 24, 1) = '-' AND "projectId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "ProjectFeature_governanceSnapshotId_uuid_check" CHECK (
      "governanceSnapshotId" IS NULL OR (
        length("governanceSnapshotId") = 36 AND length(replace("governanceSnapshotId", '-', '')) = 32 AND substr("governanceSnapshotId", 9, 1) = '-' AND
        substr("governanceSnapshotId", 14, 1) = '-' AND substr("governanceSnapshotId", 19, 1) = '-' AND
        substr("governanceSnapshotId", 24, 1) = '-' AND "governanceSnapshotId" NOT GLOB '*[^0-9a-fA-F-]*'
      )
    ),
    CONSTRAINT "ProjectFeature_deleteBatchId_uuid_check" CHECK (
      "deleteBatchId" IS NULL OR (
        length("deleteBatchId") = 36 AND length(replace("deleteBatchId", '-', '')) = 32 AND substr("deleteBatchId", 9, 1) = '-' AND
        substr("deleteBatchId", 14, 1) = '-' AND substr("deleteBatchId", 19, 1) = '-' AND
        substr("deleteBatchId", 24, 1) = '-' AND "deleteBatchId" NOT GLOB '*[^0-9a-fA-F-]*'
      )
    ),
    CONSTRAINT "ProjectFeature_code_bounds" CHECK (length("code") BETWEEN 1 AND 128),
    CONSTRAINT "ProjectFeature_title_bounds" CHECK (length("title") BETWEEN 1 AND 500),
    CONSTRAINT "ProjectFeature_problem_bounds" CHECK (length("problem") BETWEEN 1 AND 5000),
    CONSTRAINT "ProjectFeature_outcome_bounds" CHECK (length("outcome") BETWEEN 1 AND 5000),
    CONSTRAINT "ProjectFeature_primaryDomainId_bounds" CHECK (length("primaryDomainId") BETWEEN 1 AND 128),
    CONSTRAINT "ProjectFeature_canonicalFeatureKey_bounds" CHECK (
      "canonicalFeatureKey" IS NULL OR length("canonicalFeatureKey") BETWEEN 1 AND 200
    ),
    CONSTRAINT "ProjectFeature_canonicalPair_check" CHECK (
      ("canonicalFeatureKey" IS NULL AND "governanceSnapshotId" IS NULL) OR
      ("canonicalFeatureKey" IS NOT NULL AND "governanceSnapshotId" IS NOT NULL)
    ),
    CONSTRAINT "ProjectFeature_lifecycle_check" CHECK (
      "lifecycle" IN ('DRAFT', 'ACTIVE', 'RETIRED')
    ),
    CONSTRAINT "ProjectFeature_version_check" CHECK (
      typeof("version") = 'integer' AND "version" >= 1
    ),
    CONSTRAINT "ProjectFeature_deletePair_check" CHECK (
      ("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR
      ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL)
    ),
    CONSTRAINT "ProjectFeature_tenantId_fkey" FOREIGN KEY ("tenantId")
      REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectFeature_businessId_fkey" FOREIGN KEY ("businessId")
      REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectFeature_projectId_fkey" FOREIGN KEY ("projectId")
      REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectFeature_governanceSnapshotId_fkey" FOREIGN KEY ("governanceSnapshotId")
      REFERENCES "GovernanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Restore order 3: supporting Domain responsibilities.
CREATE TABLE "FeatureContribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "responsibility" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "deleteBatchId" TEXT,
    CONSTRAINT "FeatureContribution_id_uuid_check" CHECK (
      length("id") = 36 AND length(replace("id", '-', '')) = 32 AND substr("id", 9, 1) = '-' AND
      substr("id", 14, 1) = '-' AND substr("id", 19, 1) = '-' AND
      substr("id", 24, 1) = '-' AND "id" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureContribution_tenantId_uuid_check" CHECK (
      length("tenantId") = 36 AND length(replace("tenantId", '-', '')) = 32 AND substr("tenantId", 9, 1) = '-' AND
      substr("tenantId", 14, 1) = '-' AND substr("tenantId", 19, 1) = '-' AND
      substr("tenantId", 24, 1) = '-' AND "tenantId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureContribution_businessId_uuid_check" CHECK (
      length("businessId") = 36 AND length(replace("businessId", '-', '')) = 32 AND substr("businessId", 9, 1) = '-' AND
      substr("businessId", 14, 1) = '-' AND substr("businessId", 19, 1) = '-' AND
      substr("businessId", 24, 1) = '-' AND "businessId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureContribution_featureId_uuid_check" CHECK (
      length("featureId") = 36 AND length(replace("featureId", '-', '')) = 32 AND substr("featureId", 9, 1) = '-' AND
      substr("featureId", 14, 1) = '-' AND substr("featureId", 19, 1) = '-' AND
      substr("featureId", 24, 1) = '-' AND "featureId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureContribution_deleteBatchId_uuid_check" CHECK (
      "deleteBatchId" IS NULL OR (
        length("deleteBatchId") = 36 AND length(replace("deleteBatchId", '-', '')) = 32 AND substr("deleteBatchId", 9, 1) = '-' AND
        substr("deleteBatchId", 14, 1) = '-' AND substr("deleteBatchId", 19, 1) = '-' AND
        substr("deleteBatchId", 24, 1) = '-' AND "deleteBatchId" NOT GLOB '*[^0-9a-fA-F-]*'
      )
    ),
    CONSTRAINT "FeatureContribution_domainId_bounds" CHECK (length("domainId") BETWEEN 1 AND 128),
    CONSTRAINT "FeatureContribution_responsibility_bounds" CHECK (length("responsibility") BETWEEN 1 AND 2000),
    CONSTRAINT "FeatureContribution_version_check" CHECK (
      typeof("version") = 'integer' AND "version" >= 1
    ),
    CONSTRAINT "FeatureContribution_deletePair_check" CHECK (
      ("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR
      ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL)
    ),
    CONSTRAINT "FeatureContribution_tenantId_fkey" FOREIGN KEY ("tenantId")
      REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeatureContribution_businessId_fkey" FOREIGN KEY ("businessId")
      REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeatureContribution_featureId_fkey" FOREIGN KEY ("featureId")
      REFERENCES "ProjectFeature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Restore order 4: WorkItem-to-Feature links.
CREATE TABLE "FeatureWorkLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "allocationBps" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "deleteBatchId" TEXT,
    CONSTRAINT "FeatureWorkLink_id_uuid_check" CHECK (
      length("id") = 36 AND length(replace("id", '-', '')) = 32 AND substr("id", 9, 1) = '-' AND
      substr("id", 14, 1) = '-' AND substr("id", 19, 1) = '-' AND
      substr("id", 24, 1) = '-' AND "id" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureWorkLink_tenantId_uuid_check" CHECK (
      length("tenantId") = 36 AND length(replace("tenantId", '-', '')) = 32 AND substr("tenantId", 9, 1) = '-' AND
      substr("tenantId", 14, 1) = '-' AND substr("tenantId", 19, 1) = '-' AND
      substr("tenantId", 24, 1) = '-' AND "tenantId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureWorkLink_businessId_uuid_check" CHECK (
      length("businessId") = 36 AND length(replace("businessId", '-', '')) = 32 AND substr("businessId", 9, 1) = '-' AND
      substr("businessId", 14, 1) = '-' AND substr("businessId", 19, 1) = '-' AND
      substr("businessId", 24, 1) = '-' AND "businessId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureWorkLink_featureId_uuid_check" CHECK (
      length("featureId") = 36 AND length(replace("featureId", '-', '')) = 32 AND substr("featureId", 9, 1) = '-' AND
      substr("featureId", 14, 1) = '-' AND substr("featureId", 19, 1) = '-' AND
      substr("featureId", 24, 1) = '-' AND "featureId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureWorkLink_workItemId_uuid_check" CHECK (
      length("workItemId") = 36 AND length(replace("workItemId", '-', '')) = 32 AND substr("workItemId", 9, 1) = '-' AND
      substr("workItemId", 14, 1) = '-' AND substr("workItemId", 19, 1) = '-' AND
      substr("workItemId", 24, 1) = '-' AND "workItemId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "FeatureWorkLink_deleteBatchId_uuid_check" CHECK (
      "deleteBatchId" IS NULL OR (
        length("deleteBatchId") = 36 AND length(replace("deleteBatchId", '-', '')) = 32 AND substr("deleteBatchId", 9, 1) = '-' AND
        substr("deleteBatchId", 14, 1) = '-' AND substr("deleteBatchId", 19, 1) = '-' AND
        substr("deleteBatchId", 24, 1) = '-' AND "deleteBatchId" NOT GLOB '*[^0-9a-fA-F-]*'
      )
    ),
    CONSTRAINT "FeatureWorkLink_allocationBps_check" CHECK (
      "allocationBps" IS NULL OR (
        typeof("allocationBps") = 'integer' AND "allocationBps" BETWEEN 0 AND 10000
      )
    ),
    CONSTRAINT "FeatureWorkLink_version_check" CHECK (
      typeof("version") = 'integer' AND "version" >= 1
    ),
    CONSTRAINT "FeatureWorkLink_deletePair_check" CHECK (
      ("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR
      ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL)
    ),
    CONSTRAINT "FeatureWorkLink_tenantId_fkey" FOREIGN KEY ("tenantId")
      REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeatureWorkLink_businessId_fkey" FOREIGN KEY ("businessId")
      REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeatureWorkLink_featureId_fkey" FOREIGN KEY ("featureId")
      REFERENCES "ProjectFeature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FeatureWorkLink_workItemId_fkey" FOREIGN KEY ("workItemId")
      REFERENCES "WorkItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Restore order 5: requirement references proved by immutable snapshots.
CREATE TABLE "RequirementBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,
    "governanceSnapshotId" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "revisionHash" TEXT NOT NULL,
    "acceptanceRef" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" DATETIME,
    "deleteBatchId" TEXT,
    CONSTRAINT "RequirementBinding_id_uuid_check" CHECK (
      length("id") = 36 AND length(replace("id", '-', '')) = 32 AND substr("id", 9, 1) = '-' AND
      substr("id", 14, 1) = '-' AND substr("id", 19, 1) = '-' AND
      substr("id", 24, 1) = '-' AND "id" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "RequirementBinding_tenantId_uuid_check" CHECK (
      length("tenantId") = 36 AND length(replace("tenantId", '-', '')) = 32 AND substr("tenantId", 9, 1) = '-' AND
      substr("tenantId", 14, 1) = '-' AND substr("tenantId", 19, 1) = '-' AND
      substr("tenantId", 24, 1) = '-' AND "tenantId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "RequirementBinding_businessId_uuid_check" CHECK (
      length("businessId") = 36 AND length(replace("businessId", '-', '')) = 32 AND substr("businessId", 9, 1) = '-' AND
      substr("businessId", 14, 1) = '-' AND substr("businessId", 19, 1) = '-' AND
      substr("businessId", 24, 1) = '-' AND "businessId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "RequirementBinding_featureId_uuid_check" CHECK (
      length("featureId") = 36 AND length(replace("featureId", '-', '')) = 32 AND substr("featureId", 9, 1) = '-' AND
      substr("featureId", 14, 1) = '-' AND substr("featureId", 19, 1) = '-' AND
      substr("featureId", 24, 1) = '-' AND "featureId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "RequirementBinding_governanceSnapshotId_uuid_check" CHECK (
      length("governanceSnapshotId") = 36 AND length(replace("governanceSnapshotId", '-', '')) = 32 AND substr("governanceSnapshotId", 9, 1) = '-' AND
      substr("governanceSnapshotId", 14, 1) = '-' AND substr("governanceSnapshotId", 19, 1) = '-' AND
      substr("governanceSnapshotId", 24, 1) = '-' AND "governanceSnapshotId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "RequirementBinding_deleteBatchId_uuid_check" CHECK (
      "deleteBatchId" IS NULL OR (
        length("deleteBatchId") = 36 AND length(replace("deleteBatchId", '-', '')) = 32 AND substr("deleteBatchId", 9, 1) = '-' AND
        substr("deleteBatchId", 14, 1) = '-' AND substr("deleteBatchId", 19, 1) = '-' AND
        substr("deleteBatchId", 24, 1) = '-' AND "deleteBatchId" NOT GLOB '*[^0-9a-fA-F-]*'
      )
    ),
    CONSTRAINT "RequirementBinding_sourceNamespace_bounds" CHECK (length("sourceNamespace") BETWEEN 1 AND 128),
    CONSTRAINT "RequirementBinding_requirementKey_bounds" CHECK (length("requirementKey") BETWEEN 1 AND 128),
    CONSTRAINT "RequirementBinding_revisionHash_sha256" CHECK (
      length("revisionHash") = 64 AND "revisionHash" NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "RequirementBinding_acceptanceRef_bounds" CHECK (length("acceptanceRef") BETWEEN 1 AND 1000),
    CONSTRAINT "RequirementBinding_version_check" CHECK (
      typeof("version") = 'integer' AND "version" >= 1
    ),
    CONSTRAINT "RequirementBinding_deletePair_check" CHECK (
      ("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR
      ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL)
    ),
    CONSTRAINT "RequirementBinding_tenantId_fkey" FOREIGN KEY ("tenantId")
      REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RequirementBinding_businessId_fkey" FOREIGN KEY ("businessId")
      REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RequirementBinding_featureId_fkey" FOREIGN KEY ("featureId")
      REFERENCES "ProjectFeature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RequirementBinding_governanceSnapshotId_fkey" FOREIGN KEY ("governanceSnapshotId")
      REFERENCES "GovernanceSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Restore order 6: technical mutation/idempotency ledger. The tuple check is
-- the portable storage backstop; the Postgres RLS policy repeats the same
-- mapping with parent/resource joins.
CREATE TABLE "ProjectFeatureMutationReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "featureId" TEXT,
    "targetId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "httpMethod" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "version" INTEGER,
    "etag" TEXT NOT NULL,
    "auditEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMMITTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectFeatureMutationReceipt_id_uuid_check" CHECK (
      length("id") = 36 AND length(replace("id", '-', '')) = 32 AND substr("id", 9, 1) = '-' AND
      substr("id", 14, 1) = '-' AND substr("id", 19, 1) = '-' AND
      substr("id", 24, 1) = '-' AND "id" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_scope_uuid_check" CHECK (
      length("tenantId") = 36 AND length(replace("tenantId", '-', '')) = 32 AND substr("tenantId", 9, 1) = '-' AND
      substr("tenantId", 14, 1) = '-' AND substr("tenantId", 19, 1) = '-' AND
      substr("tenantId", 24, 1) = '-' AND "tenantId" NOT GLOB '*[^0-9a-fA-F-]*' AND
      length("businessId") = 36 AND length(replace("businessId", '-', '')) = 32 AND substr("businessId", 9, 1) = '-' AND
      substr("businessId", 14, 1) = '-' AND substr("businessId", 19, 1) = '-' AND
      substr("businessId", 24, 1) = '-' AND "businessId" NOT GLOB '*[^0-9a-fA-F-]*' AND
      length("projectId") = 36 AND length(replace("projectId", '-', '')) = 32 AND substr("projectId", 9, 1) = '-' AND
      substr("projectId", 14, 1) = '-' AND substr("projectId", 19, 1) = '-' AND
      substr("projectId", 24, 1) = '-' AND "projectId" NOT GLOB '*[^0-9a-fA-F-]*' AND
      length("targetId") = 36 AND length(replace("targetId", '-', '')) = 32 AND substr("targetId", 9, 1) = '-' AND
      substr("targetId", 14, 1) = '-' AND substr("targetId", 19, 1) = '-' AND
      substr("targetId", 24, 1) = '-' AND "targetId" NOT GLOB '*[^0-9a-fA-F-]*' AND
      length("principalId") = 36 AND length(replace("principalId", '-', '')) = 32 AND substr("principalId", 9, 1) = '-' AND
      substr("principalId", 14, 1) = '-' AND substr("principalId", 19, 1) = '-' AND
      substr("principalId", 24, 1) = '-' AND "principalId" NOT GLOB '*[^0-9a-fA-F-]*' AND
      length("resourceId") = 36 AND length(replace("resourceId", '-', '')) = 32 AND substr("resourceId", 9, 1) = '-' AND
      substr("resourceId", 14, 1) = '-' AND substr("resourceId", 19, 1) = '-' AND
      substr("resourceId", 24, 1) = '-' AND "resourceId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_featureId_uuid_check" CHECK (
      "featureId" IS NULL OR (
        length("featureId") = 36 AND length(replace("featureId", '-', '')) = 32 AND substr("featureId", 9, 1) = '-' AND
        substr("featureId", 14, 1) = '-' AND substr("featureId", 19, 1) = '-' AND
        substr("featureId", 24, 1) = '-' AND "featureId" NOT GLOB '*[^0-9a-fA-F-]*'
      )
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_auditEventId_uuid_check" CHECK (
      length("auditEventId") = 36 AND length(replace("auditEventId", '-', '')) = 32 AND substr("auditEventId", 9, 1) = '-' AND
      substr("auditEventId", 14, 1) = '-' AND substr("auditEventId", 19, 1) = '-' AND
      substr("auditEventId", 24, 1) = '-' AND "auditEventId" NOT GLOB '*[^0-9a-fA-F-]*'
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_targetType_check" CHECK (
      "targetType" IN ('FEATURE', 'PROJECT')
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_httpMethod_check" CHECK (
      "httpMethod" IN ('POST', 'PATCH', 'PUT', 'DELETE')
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_operation_check" CHECK (
      "operation" IN (
        'CREATE_FEATURE', 'UPDATE_FEATURE', 'REPLACE_CONTRIBUTIONS',
        'REPLACE_WORK_LINKS', 'REPLACE_FEATURE_WORK_GRAPH',
        'REPLACE_REQUIREMENT_BINDINGS', 'DELETE_FEATURE', 'RESTORE_FEATURE',
        'CAPTURE_GOVERNANCE_SNAPSHOT'
      )
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_idempotencyKey_bounds" CHECK (
      length("idempotencyKey") BETWEEN 8 AND 128
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_payloadHash_sha256" CHECK (
      length("payloadHash") = 64 AND "payloadHash" NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_resourceType_check" CHECK (
      "resourceType" IN ('PROJECT_FEATURE', 'PROJECT_FEATURE_GRAPH', 'GOVERNANCE_SNAPSHOT')
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_etag_bounds" CHECK (
      length("etag") BETWEEN 1 AND 4096
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_status_check" CHECK (
      "status" = 'COMMITTED'
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_version_check" CHECK (
      "version" IS NULL OR (
        typeof("version") = 'integer' AND "version" >= 1
      )
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_tuple_check" CHECK (
      (
        "operation" = 'CREATE_FEATURE' AND "httpMethod" = 'POST' AND
        "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
        "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
        "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
      ) OR (
        "operation" = 'UPDATE_FEATURE' AND "httpMethod" = 'PATCH' AND
        "targetType" = 'FEATURE' AND "featureId" IS NOT NULL AND
        "targetId" = "featureId" AND "resourceType" = 'PROJECT_FEATURE' AND
        "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
      ) OR (
        "operation" IN ('REPLACE_CONTRIBUTIONS', 'REPLACE_WORK_LINKS',
          'REPLACE_REQUIREMENT_BINDINGS') AND "httpMethod" = 'PUT' AND
        "targetType" = 'FEATURE' AND "featureId" IS NOT NULL AND
        "targetId" = "featureId" AND "resourceType" = 'PROJECT_FEATURE' AND
        "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
      ) OR (
        "operation" = 'DELETE_FEATURE' AND "httpMethod" = 'DELETE' AND
        "targetType" = 'FEATURE' AND "featureId" IS NOT NULL AND
        "targetId" = "featureId" AND "resourceType" = 'PROJECT_FEATURE' AND
        "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
      ) OR (
        "operation" = 'RESTORE_FEATURE' AND "httpMethod" = 'POST' AND
        "targetType" = 'FEATURE' AND "featureId" IS NOT NULL AND
        "targetId" = "featureId" AND "resourceType" = 'PROJECT_FEATURE' AND
        "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
      ) OR (
        "operation" = 'REPLACE_FEATURE_WORK_GRAPH' AND "httpMethod" = 'PUT' AND
        "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
        "resourceType" = 'PROJECT_FEATURE_GRAPH' AND "resourceId" = "projectId" AND
        "featureId" IS NULL AND "version" IS NULL
      ) OR (
        "operation" = 'CAPTURE_GOVERNANCE_SNAPSHOT' AND "httpMethod" = 'POST' AND
        "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
        "resourceType" = 'GOVERNANCE_SNAPSHOT' AND "featureId" IS NULL AND
        "version" IS NULL
      )
    ),
    CONSTRAINT "ProjectFeatureMutationReceipt_tenantId_fkey" FOREIGN KEY ("tenantId")
      REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectFeatureMutationReceipt_businessId_fkey" FOREIGN KEY ("businessId")
      REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectFeatureMutationReceipt_projectId_fkey" FOREIGN KEY ("projectId")
      REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectFeatureMutationReceipt_featureId_fkey" FOREIGN KEY ("featureId")
      REFERENCES "ProjectFeature" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProjectFeatureMutationReceipt_auditEventId_fkey" FOREIGN KEY ("auditEventId")
      REFERENCES "AuditEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GovernanceSnapshot_business_repository_commit_manifest_key"
  ON "GovernanceSnapshot" ("businessId", "repositoryId", "commitSha", "manifestHash");
CREATE INDEX "GovernanceSnapshot_business_repository_capturedAt_idx"
  ON "GovernanceSnapshot" ("businessId", "repositoryId", "capturedAt");

CREATE UNIQUE INDEX "ProjectFeature_project_code_key"
  ON "ProjectFeature" ("projectId", "code");
CREATE INDEX "ProjectFeature_business_project_lifecycle_idx"
  ON "ProjectFeature" ("businessId", "projectId", "lifecycle");

CREATE UNIQUE INDEX "FeatureContribution_feature_domain_key"
  ON "FeatureContribution" ("featureId", "domainId");
CREATE INDEX "FeatureContribution_business_domain_idx"
  ON "FeatureContribution" ("businessId", "domainId");

CREATE UNIQUE INDEX "FeatureWorkLink_feature_work_item_key"
  ON "FeatureWorkLink" ("featureId", "workItemId");
CREATE INDEX "FeatureWorkLink_business_work_item_idx"
  ON "FeatureWorkLink" ("businessId", "workItemId");

CREATE UNIQUE INDEX "RequirementBinding_feature_snapshot_namespace_requirement_key"
  ON "RequirementBinding" ("featureId", "governanceSnapshotId", "sourceNamespace", "requirementKey");
CREATE INDEX "RequirementBinding_business_requirement_idx"
  ON "RequirementBinding" ("businessId", "requirementKey");

CREATE UNIQUE INDEX "ProjectFeatureMutationReceipt_scope_idempotency_key"
  ON "ProjectFeatureMutationReceipt" (
    "tenantId", "businessId", "principalId", "operation", "targetId", "idempotencyKey"
  );
