-- @req FR-252 — Phase B Feature authority persistence for the provider schema.
-- @spec ADR-097; docs/architecture/project-manager-system/25-PHASE-B-PERSISTENCE-SECURITY-POLICY.md
-- @tested tests/unit/phase-b-feature-migration.test.js
--
-- Additive only and NOT APPLIED by this change. The ordinary runtime role is
-- granted only the bounded access below. A separate owner-instructed
-- maintenance gate is required for full backup/restore import privileges.
-- The six new records are intentionally kept in the same migration as their
-- SQLite twin; no existing table, role, credential or default privilege is
-- changed here.

BEGIN;

CREATE TABLE IF NOT EXISTS "GovernanceSnapshot" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"          TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "repositoryId"        TEXT NOT NULL REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectRepositoryId" TEXT NOT NULL REFERENCES "ProjectRepository"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "checkoutBindingId"   TEXT NOT NULL,
  "commitSha"           TEXT NOT NULL,
  "manifestHash"        TEXT NOT NULL,
  "capturedAt"          TIMESTAMP(3) NOT NULL,
  "verifiedAt"          TIMESTAMP(3) NOT NULL,
  "verifierId"          TEXT NOT NULL,
  "verifierVersion"     TEXT NOT NULL,
  "proofId"             TEXT NOT NULL,
  "verificationProof"   TEXT NOT NULL,
  "validationStatus"    TEXT NOT NULL,
  "sourceManifest"      TEXT NOT NULL,
  CONSTRAINT "GovernanceSnapshot_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_repositoryId_uuid_check" CHECK ("repositoryId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_projectRepositoryId_uuid_check" CHECK ("projectRepositoryId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_proofId_uuid_check" CHECK ("proofId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_checkoutBindingId_bounds" CHECK (length("checkoutBindingId") BETWEEN 1 AND 256),
  CONSTRAINT "GovernanceSnapshot_commitSha_bounds" CHECK ("commitSha" ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'),
  CONSTRAINT "GovernanceSnapshot_manifestHash_sha256" CHECK ("manifestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "GovernanceSnapshot_verifierId_bounds" CHECK (length("verifierId") BETWEEN 1 AND 128),
  CONSTRAINT "GovernanceSnapshot_verifierVersion_bounds" CHECK (length("verifierVersion") BETWEEN 1 AND 64),
  CONSTRAINT "GovernanceSnapshot_verificationProof_object" CHECK (jsonb_typeof("verificationProof"::jsonb) = 'object'),
  CONSTRAINT "GovernanceSnapshot_validationStatus_check" CHECK ("validationStatus" = 'VALID'),
  CONSTRAINT "GovernanceSnapshot_sourceManifest_bounds" CHECK (octet_length("sourceManifest") BETWEEN 1 AND 1048576),
  CONSTRAINT "GovernanceSnapshot_sourceManifest_object" CHECK (jsonb_typeof("sourceManifest"::jsonb) = 'object')
);

CREATE TABLE IF NOT EXISTS "ProjectFeature" (
  "id"                   TEXT PRIMARY KEY,
  "tenantId"             TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"           TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId"            TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code"                 TEXT NOT NULL,
  "title"                TEXT NOT NULL,
  "problem"              TEXT NOT NULL,
  "outcome"              TEXT NOT NULL,
  "primaryDomainId"      TEXT NOT NULL,
  "canonicalFeatureKey"  TEXT,
  "governanceSnapshotId" TEXT REFERENCES "GovernanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "lifecycle"            TEXT NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  "version"              INTEGER NOT NULL DEFAULT 1,
  "deletedAt"            TIMESTAMP(3),
  "deleteBatchId"        TEXT,
  CONSTRAINT "ProjectFeature_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_projectId_uuid_check" CHECK ("projectId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_governanceSnapshotId_uuid_check" CHECK ("governanceSnapshotId" IS NULL OR "governanceSnapshotId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_code_bounds" CHECK (length("code") BETWEEN 1 AND 128),
  CONSTRAINT "ProjectFeature_title_bounds" CHECK (length("title") BETWEEN 1 AND 500),
  CONSTRAINT "ProjectFeature_problem_bounds" CHECK (length("problem") BETWEEN 1 AND 5000),
  CONSTRAINT "ProjectFeature_outcome_bounds" CHECK (length("outcome") BETWEEN 1 AND 5000),
  CONSTRAINT "ProjectFeature_primaryDomainId_bounds" CHECK (length("primaryDomainId") BETWEEN 1 AND 128),
  CONSTRAINT "ProjectFeature_canonicalFeatureKey_bounds" CHECK ("canonicalFeatureKey" IS NULL OR length("canonicalFeatureKey") BETWEEN 1 AND 200),
  CONSTRAINT "ProjectFeature_canonicalPair_check" CHECK (("canonicalFeatureKey" IS NULL AND "governanceSnapshotId" IS NULL) OR ("canonicalFeatureKey" IS NOT NULL AND "governanceSnapshotId" IS NOT NULL)),
  CONSTRAINT "ProjectFeature_lifecycle_check" CHECK ("lifecycle" IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT "ProjectFeature_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ProjectFeature_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "FeatureContribution" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"     TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "featureId"      TEXT NOT NULL REFERENCES "ProjectFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "domainId"       TEXT NOT NULL,
  "responsibility" TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "version"        INTEGER NOT NULL DEFAULT 1,
  "deletedAt"      TIMESTAMP(3),
  "deleteBatchId"  TEXT,
  CONSTRAINT "FeatureContribution_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_domainId_bounds" CHECK (length("domainId") BETWEEN 1 AND 128),
  CONSTRAINT "FeatureContribution_responsibility_bounds" CHECK (length("responsibility") BETWEEN 1 AND 2000),
  CONSTRAINT "FeatureContribution_version_check" CHECK ("version" >= 1),
  CONSTRAINT "FeatureContribution_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "FeatureWorkLink" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"    TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "featureId"     TEXT NOT NULL REFERENCES "ProjectFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "workItemId"    TEXT NOT NULL REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "allocationBps" INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 1,
  "deletedAt"     TIMESTAMP(3),
  "deleteBatchId" TEXT,
  CONSTRAINT "FeatureWorkLink_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_workItemId_uuid_check" CHECK ("workItemId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_allocationBps_check" CHECK ("allocationBps" IS NULL OR "allocationBps" BETWEEN 0 AND 10000),
  CONSTRAINT "FeatureWorkLink_version_check" CHECK ("version" >= 1),
  CONSTRAINT "FeatureWorkLink_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "RequirementBinding" (
  "id"                   TEXT PRIMARY KEY,
  "tenantId"             TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"           TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "featureId"            TEXT NOT NULL REFERENCES "ProjectFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "governanceSnapshotId" TEXT NOT NULL REFERENCES "GovernanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceNamespace"      TEXT NOT NULL,
  "requirementKey"       TEXT NOT NULL,
  "revisionHash"         TEXT NOT NULL,
  "acceptanceRef"        TEXT NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  "version"              INTEGER NOT NULL DEFAULT 1,
  "deletedAt"            TIMESTAMP(3),
  "deleteBatchId"        TEXT,
  CONSTRAINT "RequirementBinding_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_governanceSnapshotId_uuid_check" CHECK ("governanceSnapshotId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_sourceNamespace_bounds" CHECK (length("sourceNamespace") BETWEEN 1 AND 128),
  CONSTRAINT "RequirementBinding_requirementKey_bounds" CHECK (length("requirementKey") BETWEEN 1 AND 128),
  CONSTRAINT "RequirementBinding_revisionHash_sha256" CHECK ("revisionHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RequirementBinding_acceptanceRef_bounds" CHECK (length("acceptanceRef") BETWEEN 1 AND 1000),
  CONSTRAINT "RequirementBinding_version_check" CHECK ("version" >= 1),
  CONSTRAINT "RequirementBinding_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "ProjectFeatureMutationReceipt" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"     TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId"      TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "featureId"      TEXT REFERENCES "ProjectFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetId"       TEXT NOT NULL,
  "targetType"     TEXT NOT NULL,
  "httpMethod"     TEXT NOT NULL,
  "principalId"    TEXT NOT NULL,
  "operation"      TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash"    TEXT NOT NULL,
  "resourceId"     TEXT NOT NULL,
  "resourceType"   TEXT NOT NULL,
  "version"        INTEGER,
  "etag"           TEXT NOT NULL,
  "auditEventId"   TEXT NOT NULL REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status"         TEXT NOT NULL DEFAULT 'COMMITTED',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ProjectFeatureMutationReceipt_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_projectId_uuid_check" CHECK ("projectId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_featureId_uuid_check" CHECK ("featureId" IS NULL OR "featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_targetId_uuid_check" CHECK ("targetId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_principalId_uuid_check" CHECK ("principalId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_resourceId_uuid_check" CHECK ("resourceId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_auditEventId_uuid_check" CHECK ("auditEventId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_targetType_check" CHECK ("targetType" IN ('FEATURE', 'PROJECT')),
  CONSTRAINT "ProjectFeatureMutationReceipt_httpMethod_check" CHECK ("httpMethod" IN ('POST', 'PATCH', 'PUT', 'DELETE')),
  CONSTRAINT "ProjectFeatureMutationReceipt_operation_check" CHECK ("operation" IN ('CREATE_FEATURE', 'UPDATE_FEATURE', 'REPLACE_CONTRIBUTIONS', 'REPLACE_WORK_LINKS', 'REPLACE_FEATURE_WORK_GRAPH', 'REPLACE_REQUIREMENT_BINDINGS', 'DELETE_FEATURE', 'RESTORE_FEATURE', 'CAPTURE_GOVERNANCE_SNAPSHOT')),
  CONSTRAINT "ProjectFeatureMutationReceipt_idempotencyKey_bounds" CHECK (length("idempotencyKey") BETWEEN 8 AND 128),
  CONSTRAINT "ProjectFeatureMutationReceipt_payloadHash_sha256" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_resourceType_check" CHECK ("resourceType" IN ('PROJECT_FEATURE', 'PROJECT_FEATURE_GRAPH', 'GOVERNANCE_SNAPSHOT')),
  CONSTRAINT "ProjectFeatureMutationReceipt_etag_bounds" CHECK (length("etag") BETWEEN 1 AND 4096),
  CONSTRAINT "ProjectFeatureMutationReceipt_status_check" CHECK ("status" = 'COMMITTED'),
  CONSTRAINT "ProjectFeatureMutationReceipt_tuple_check" CHECK (
    (
      "operation" = 'CREATE_FEATURE' AND "httpMethod" = 'POST' AND
      "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" = 'UPDATE_FEATURE' AND "httpMethod" = 'PATCH' AND
      "targetType" = 'FEATURE' AND "targetId" = "featureId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" IN ('REPLACE_CONTRIBUTIONS', 'REPLACE_WORK_LINKS', 'REPLACE_REQUIREMENT_BINDINGS') AND
      "httpMethod" = 'PUT' AND "targetType" = 'FEATURE' AND "targetId" = "featureId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" = 'REPLACE_FEATURE_WORK_GRAPH' AND "httpMethod" = 'PUT' AND
      "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
      "resourceType" = 'PROJECT_FEATURE_GRAPH' AND "resourceId" = "projectId" AND
      "featureId" IS NULL AND "version" IS NULL
    ) OR (
      "operation" = 'DELETE_FEATURE' AND "httpMethod" = 'DELETE' AND
      "targetType" = 'FEATURE' AND "targetId" = "featureId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" = 'RESTORE_FEATURE' AND "httpMethod" = 'POST' AND
      "targetType" = 'FEATURE' AND "targetId" = "featureId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" = 'CAPTURE_GOVERNANCE_SNAPSHOT' AND "httpMethod" = 'POST' AND
      "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
      "resourceType" = 'GOVERNANCE_SNAPSHOT' AND "featureId" IS NULL AND
      "version" IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "GovernanceSnapshot_business_repository_commit_manifest_key"
  ON "GovernanceSnapshot" ("businessId", "repositoryId", "commitSha", "manifestHash");
CREATE INDEX IF NOT EXISTS "GovernanceSnapshot_business_repository_capturedAt_idx"
  ON "GovernanceSnapshot" ("businessId", "repositoryId", "capturedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectFeature_project_code_key"
  ON "ProjectFeature" ("projectId", "code");
CREATE INDEX IF NOT EXISTS "ProjectFeature_business_project_lifecycle_idx"
  ON "ProjectFeature" ("businessId", "projectId", "lifecycle");
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureContribution_feature_domain_key"
  ON "FeatureContribution" ("featureId", "domainId");
CREATE INDEX IF NOT EXISTS "FeatureContribution_business_domain_idx"
  ON "FeatureContribution" ("businessId", "domainId");
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureWorkLink_feature_work_item_key"
  ON "FeatureWorkLink" ("featureId", "workItemId");
CREATE INDEX IF NOT EXISTS "FeatureWorkLink_business_work_item_idx"
  ON "FeatureWorkLink" ("businessId", "workItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "RequirementBinding_feature_snapshot_namespace_requirement_key"
  ON "RequirementBinding" ("featureId", "governanceSnapshotId", "sourceNamespace", "requirementKey");
CREATE INDEX IF NOT EXISTS "RequirementBinding_business_requirement_idx"
  ON "RequirementBinding" ("businessId", "requirementKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectFeatureMutationReceipt_scope_idempotency_key"
  ON "ProjectFeatureMutationReceipt" ("tenantId", "businessId", "principalId", "operation", "targetId", "idempotencyKey");

-- Parse an independent expected catalog in a transaction-owned schema.
-- PostgreSQL forbids temporary-table FKs to permanent parents. This schema is
-- created without IF NOT EXISTS, so a pre-existing schema refuses immediately;
-- only these newly created empty verification objects are dropped below.
-- Compare complete definitions rather than names or marker substrings.
CREATE SCHEMA "__phase_b_expected";
CREATE TABLE "__phase_b_expected"."__phase_b_expected_GovernanceSnapshot" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"          TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "repositoryId"        TEXT NOT NULL REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectRepositoryId" TEXT NOT NULL REFERENCES "ProjectRepository"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "checkoutBindingId"   TEXT NOT NULL,
  "commitSha"           TEXT NOT NULL,
  "manifestHash"        TEXT NOT NULL,
  "capturedAt"          TIMESTAMP(3) NOT NULL,
  "verifiedAt"          TIMESTAMP(3) NOT NULL,
  "verifierId"          TEXT NOT NULL,
  "verifierVersion"     TEXT NOT NULL,
  "proofId"             TEXT NOT NULL,
  "verificationProof"   TEXT NOT NULL,
  "validationStatus"    TEXT NOT NULL,
  "sourceManifest"      TEXT NOT NULL,
  CONSTRAINT "GovernanceSnapshot_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_repositoryId_uuid_check" CHECK ("repositoryId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_projectRepositoryId_uuid_check" CHECK ("projectRepositoryId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_proofId_uuid_check" CHECK ("proofId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "GovernanceSnapshot_checkoutBindingId_bounds" CHECK (length("checkoutBindingId") BETWEEN 1 AND 256),
  CONSTRAINT "GovernanceSnapshot_commitSha_bounds" CHECK ("commitSha" ~ '^[a-f0-9]{40}([a-f0-9]{24})?$'),
  CONSTRAINT "GovernanceSnapshot_manifestHash_sha256" CHECK ("manifestHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "GovernanceSnapshot_verifierId_bounds" CHECK (length("verifierId") BETWEEN 1 AND 128),
  CONSTRAINT "GovernanceSnapshot_verifierVersion_bounds" CHECK (length("verifierVersion") BETWEEN 1 AND 64),
  CONSTRAINT "GovernanceSnapshot_verificationProof_object" CHECK (jsonb_typeof("verificationProof"::jsonb) = 'object'),
  CONSTRAINT "GovernanceSnapshot_validationStatus_check" CHECK ("validationStatus" = 'VALID'),
  CONSTRAINT "GovernanceSnapshot_sourceManifest_bounds" CHECK (octet_length("sourceManifest") BETWEEN 1 AND 1048576),
  CONSTRAINT "GovernanceSnapshot_sourceManifest_object" CHECK (jsonb_typeof("sourceManifest"::jsonb) = 'object')
);

CREATE TABLE "__phase_b_expected"."__phase_b_expected_ProjectFeature" (
  "id"                   TEXT PRIMARY KEY,
  "tenantId"             TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"           TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId"            TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code"                 TEXT NOT NULL,
  "title"                TEXT NOT NULL,
  "problem"              TEXT NOT NULL,
  "outcome"              TEXT NOT NULL,
  "primaryDomainId"      TEXT NOT NULL,
  "canonicalFeatureKey"  TEXT,
  "governanceSnapshotId" TEXT REFERENCES "GovernanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "lifecycle"            TEXT NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  "version"              INTEGER NOT NULL DEFAULT 1,
  "deletedAt"            TIMESTAMP(3),
  "deleteBatchId"        TEXT,
  CONSTRAINT "ProjectFeature_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_projectId_uuid_check" CHECK ("projectId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_governanceSnapshotId_uuid_check" CHECK ("governanceSnapshotId" IS NULL OR "governanceSnapshotId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeature_code_bounds" CHECK (length("code") BETWEEN 1 AND 128),
  CONSTRAINT "ProjectFeature_title_bounds" CHECK (length("title") BETWEEN 1 AND 500),
  CONSTRAINT "ProjectFeature_problem_bounds" CHECK (length("problem") BETWEEN 1 AND 5000),
  CONSTRAINT "ProjectFeature_outcome_bounds" CHECK (length("outcome") BETWEEN 1 AND 5000),
  CONSTRAINT "ProjectFeature_primaryDomainId_bounds" CHECK (length("primaryDomainId") BETWEEN 1 AND 128),
  CONSTRAINT "ProjectFeature_canonicalFeatureKey_bounds" CHECK ("canonicalFeatureKey" IS NULL OR length("canonicalFeatureKey") BETWEEN 1 AND 200),
  CONSTRAINT "ProjectFeature_canonicalPair_check" CHECK (("canonicalFeatureKey" IS NULL AND "governanceSnapshotId" IS NULL) OR ("canonicalFeatureKey" IS NOT NULL AND "governanceSnapshotId" IS NOT NULL)),
  CONSTRAINT "ProjectFeature_lifecycle_check" CHECK ("lifecycle" IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT "ProjectFeature_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ProjectFeature_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL))
);

CREATE TABLE "__phase_b_expected"."__phase_b_expected_FeatureContribution" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"     TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "featureId"      TEXT NOT NULL REFERENCES "ProjectFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "domainId"       TEXT NOT NULL,
  "responsibility" TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "version"        INTEGER NOT NULL DEFAULT 1,
  "deletedAt"      TIMESTAMP(3),
  "deleteBatchId"  TEXT,
  CONSTRAINT "FeatureContribution_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureContribution_domainId_bounds" CHECK (length("domainId") BETWEEN 1 AND 128),
  CONSTRAINT "FeatureContribution_responsibility_bounds" CHECK (length("responsibility") BETWEEN 1 AND 2000),
  CONSTRAINT "FeatureContribution_version_check" CHECK ("version" >= 1),
  CONSTRAINT "FeatureContribution_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL))
);

CREATE TABLE "__phase_b_expected"."__phase_b_expected_FeatureWorkLink" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"    TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "featureId"     TEXT NOT NULL REFERENCES "ProjectFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "workItemId"    TEXT NOT NULL REFERENCES "WorkItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "allocationBps" INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 1,
  "deletedAt"     TIMESTAMP(3),
  "deleteBatchId" TEXT,
  CONSTRAINT "FeatureWorkLink_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_workItemId_uuid_check" CHECK ("workItemId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "FeatureWorkLink_allocationBps_check" CHECK ("allocationBps" IS NULL OR "allocationBps" BETWEEN 0 AND 10000),
  CONSTRAINT "FeatureWorkLink_version_check" CHECK ("version" >= 1),
  CONSTRAINT "FeatureWorkLink_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL))
);

CREATE TABLE "__phase_b_expected"."__phase_b_expected_RequirementBinding" (
  "id"                   TEXT PRIMARY KEY,
  "tenantId"             TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"           TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "featureId"            TEXT NOT NULL REFERENCES "ProjectFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "governanceSnapshotId" TEXT NOT NULL REFERENCES "GovernanceSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceNamespace"      TEXT NOT NULL,
  "requirementKey"       TEXT NOT NULL,
  "revisionHash"         TEXT NOT NULL,
  "acceptanceRef"        TEXT NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  "version"              INTEGER NOT NULL DEFAULT 1,
  "deletedAt"            TIMESTAMP(3),
  "deleteBatchId"        TEXT,
  CONSTRAINT "RequirementBinding_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_governanceSnapshotId_uuid_check" CHECK ("governanceSnapshotId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "RequirementBinding_sourceNamespace_bounds" CHECK (length("sourceNamespace") BETWEEN 1 AND 128),
  CONSTRAINT "RequirementBinding_requirementKey_bounds" CHECK (length("requirementKey") BETWEEN 1 AND 128),
  CONSTRAINT "RequirementBinding_revisionHash_sha256" CHECK ("revisionHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RequirementBinding_acceptanceRef_bounds" CHECK (length("acceptanceRef") BETWEEN 1 AND 1000),
  CONSTRAINT "RequirementBinding_version_check" CHECK ("version" >= 1),
  CONSTRAINT "RequirementBinding_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL))
);

CREATE TABLE "__phase_b_expected"."__phase_b_expected_ProjectFeatureMutationReceipt" (
  "id"             TEXT PRIMARY KEY,
  "tenantId"       TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"     TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId"      TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "featureId"      TEXT REFERENCES "ProjectFeature"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetId"       TEXT NOT NULL,
  "targetType"     TEXT NOT NULL,
  "httpMethod"     TEXT NOT NULL,
  "principalId"    TEXT NOT NULL,
  "operation"      TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash"    TEXT NOT NULL,
  "resourceId"     TEXT NOT NULL,
  "resourceType"   TEXT NOT NULL,
  "version"        INTEGER,
  "etag"           TEXT NOT NULL,
  "auditEventId"   TEXT NOT NULL REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status"         TEXT NOT NULL DEFAULT 'COMMITTED',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ProjectFeatureMutationReceipt_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_projectId_uuid_check" CHECK ("projectId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_featureId_uuid_check" CHECK ("featureId" IS NULL OR "featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_targetId_uuid_check" CHECK ("targetId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_principalId_uuid_check" CHECK ("principalId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_resourceId_uuid_check" CHECK ("resourceId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_auditEventId_uuid_check" CHECK ("auditEventId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_targetType_check" CHECK ("targetType" IN ('FEATURE', 'PROJECT')),
  CONSTRAINT "ProjectFeatureMutationReceipt_httpMethod_check" CHECK ("httpMethod" IN ('POST', 'PATCH', 'PUT', 'DELETE')),
  CONSTRAINT "ProjectFeatureMutationReceipt_operation_check" CHECK ("operation" IN ('CREATE_FEATURE', 'UPDATE_FEATURE', 'REPLACE_CONTRIBUTIONS', 'REPLACE_WORK_LINKS', 'REPLACE_FEATURE_WORK_GRAPH', 'REPLACE_REQUIREMENT_BINDINGS', 'DELETE_FEATURE', 'RESTORE_FEATURE', 'CAPTURE_GOVERNANCE_SNAPSHOT')),
  CONSTRAINT "ProjectFeatureMutationReceipt_idempotencyKey_bounds" CHECK (length("idempotencyKey") BETWEEN 8 AND 128),
  CONSTRAINT "ProjectFeatureMutationReceipt_payloadHash_sha256" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProjectFeatureMutationReceipt_resourceType_check" CHECK ("resourceType" IN ('PROJECT_FEATURE', 'PROJECT_FEATURE_GRAPH', 'GOVERNANCE_SNAPSHOT')),
  CONSTRAINT "ProjectFeatureMutationReceipt_etag_bounds" CHECK (length("etag") BETWEEN 1 AND 4096),
  CONSTRAINT "ProjectFeatureMutationReceipt_status_check" CHECK ("status" = 'COMMITTED'),
  CONSTRAINT "ProjectFeatureMutationReceipt_tuple_check" CHECK (
    (
      "operation" = 'CREATE_FEATURE' AND "httpMethod" = 'POST' AND
      "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" = 'UPDATE_FEATURE' AND "httpMethod" = 'PATCH' AND
      "targetType" = 'FEATURE' AND "targetId" = "featureId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" IN ('REPLACE_CONTRIBUTIONS', 'REPLACE_WORK_LINKS', 'REPLACE_REQUIREMENT_BINDINGS') AND
      "httpMethod" = 'PUT' AND "targetType" = 'FEATURE' AND "targetId" = "featureId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" = 'REPLACE_FEATURE_WORK_GRAPH' AND "httpMethod" = 'PUT' AND
      "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
      "resourceType" = 'PROJECT_FEATURE_GRAPH' AND "resourceId" = "projectId" AND
      "featureId" IS NULL AND "version" IS NULL
    ) OR (
      "operation" = 'DELETE_FEATURE' AND "httpMethod" = 'DELETE' AND
      "targetType" = 'FEATURE' AND "targetId" = "featureId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" = 'RESTORE_FEATURE' AND "httpMethod" = 'POST' AND
      "targetType" = 'FEATURE' AND "targetId" = "featureId" AND
      "resourceType" = 'PROJECT_FEATURE' AND "featureId" IS NOT NULL AND
      "resourceId" = "featureId" AND "version" IS NOT NULL AND "version" >= 1
    ) OR (
      "operation" = 'CAPTURE_GOVERNANCE_SNAPSHOT' AND "httpMethod" = 'POST' AND
      "targetType" = 'PROJECT' AND "targetId" = "projectId" AND
      "resourceType" = 'GOVERNANCE_SNAPSHOT' AND "featureId" IS NULL AND
      "version" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "GovernanceSnapshot_business_repository_commit_manifest_key"
  ON "__phase_b_expected"."__phase_b_expected_GovernanceSnapshot" ("businessId", "repositoryId", "commitSha", "manifestHash");
CREATE INDEX "GovernanceSnapshot_business_repository_capturedAt_idx"
  ON "__phase_b_expected"."__phase_b_expected_GovernanceSnapshot" ("businessId", "repositoryId", "capturedAt");
CREATE UNIQUE INDEX "ProjectFeature_project_code_key"
  ON "__phase_b_expected"."__phase_b_expected_ProjectFeature" ("projectId", "code");
CREATE INDEX "ProjectFeature_business_project_lifecycle_idx"
  ON "__phase_b_expected"."__phase_b_expected_ProjectFeature" ("businessId", "projectId", "lifecycle");
CREATE UNIQUE INDEX "FeatureContribution_feature_domain_key"
  ON "__phase_b_expected"."__phase_b_expected_FeatureContribution" ("featureId", "domainId");
CREATE INDEX "FeatureContribution_business_domain_idx"
  ON "__phase_b_expected"."__phase_b_expected_FeatureContribution" ("businessId", "domainId");
CREATE UNIQUE INDEX "FeatureWorkLink_feature_work_item_key"
  ON "__phase_b_expected"."__phase_b_expected_FeatureWorkLink" ("featureId", "workItemId");
CREATE INDEX "FeatureWorkLink_business_work_item_idx"
  ON "__phase_b_expected"."__phase_b_expected_FeatureWorkLink" ("businessId", "workItemId");
CREATE UNIQUE INDEX "RequirementBinding_feature_snapshot_namespace_requirement_key"
  ON "__phase_b_expected"."__phase_b_expected_RequirementBinding" ("featureId", "governanceSnapshotId", "sourceNamespace", "requirementKey");
CREATE INDEX "RequirementBinding_business_requirement_idx"
  ON "__phase_b_expected"."__phase_b_expected_RequirementBinding" ("businessId", "requirementKey");
CREATE UNIQUE INDEX "ProjectFeatureMutationReceipt_scope_idempotency_key"
  ON "__phase_b_expected"."__phase_b_expected_ProjectFeatureMutationReceipt" ("tenantId", "businessId", "principalId", "operation", "targetId", "idempotencyKey");

DO $phase_b_shape_guard$
DECLARE
  table_name TEXT;
  actual_oid OID;
  expected_oid OID;
  actual_signature JSONB;
  expected_signature JSONB;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['GovernanceSnapshot','ProjectFeature','FeatureContribution','FeatureWorkLink','RequirementBinding','ProjectFeatureMutationReceipt']
  LOOP
    actual_oid := to_regclass(format('public.%I', table_name));
    expected_oid := to_regclass(format('__phase_b_expected.%I', '__phase_b_expected_' || table_name));
    IF actual_oid IS NULL OR expected_oid IS NULL THEN
      RAISE EXCEPTION 'Phase B table catalog unavailable: %', table_name;
    END IF;

    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.attnum) INTO actual_signature
    FROM (
      SELECT a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) AS type,
             a.attnotnull, a.attidentity, a.attgenerated,
             pg_get_expr(d.adbin, d.adrelid) AS default_expr
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=actual_oid AND a.attnum>0 AND NOT a.attisdropped
    ) s;
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.attnum) INTO expected_signature
    FROM (
      SELECT a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) AS type,
             a.attnotnull, a.attidentity, a.attgenerated,
             pg_get_expr(d.adbin, d.adrelid) AS default_expr
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=expected_oid AND a.attnum>0 AND NOT a.attisdropped
    ) s;
    IF actual_signature IS DISTINCT FROM expected_signature THEN
      RAISE EXCEPTION 'Phase B column definition collision: %', table_name;
    END IF;

    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.definition, s.contype) INTO actual_signature
    FROM (
      SELECT c.contype, c.condeferrable, c.condeferred, c.convalidated,
             pg_get_constraintdef(c.oid, true) AS definition
      FROM pg_constraint c WHERE c.conrelid=actual_oid
    ) s;
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.definition, s.contype) INTO expected_signature
    FROM (
      SELECT c.contype, c.condeferrable, c.condeferred, c.convalidated,
             pg_get_constraintdef(c.oid, true) AS definition
      FROM pg_constraint c WHERE c.conrelid=expected_oid
    ) s;
    IF actual_signature IS DISTINCT FROM expected_signature THEN
      RAISE EXCEPTION 'Phase B constraint definition collision: %', table_name;
    END IF;

    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name) INTO actual_signature
    FROM (
      SELECT ic.relname AS name, am.amname, i.indisunique, i.indisvalid, i.indisready,
             i.indnullsnotdistinct, i.indnkeyatts, i.indnatts,
             i.indclass::text AS classes, i.indcollation::text AS collations,
             i.indoption::text AS options, pg_get_expr(i.indpred,i.indrelid) AS predicate,
             ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true)
                   FROM generate_series(1,i.indnatts) k) AS columns
      FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
      JOIN pg_am am ON am.oid=ic.relam WHERE i.indrelid=actual_oid AND NOT i.indisprimary
    ) s;
    SELECT jsonb_agg(to_jsonb(s) ORDER BY s.name) INTO expected_signature
    FROM (
      SELECT ic.relname AS name, am.amname, i.indisunique, i.indisvalid, i.indisready,
             i.indnullsnotdistinct, i.indnkeyatts, i.indnatts,
             i.indclass::text AS classes, i.indcollation::text AS collations,
             i.indoption::text AS options, pg_get_expr(i.indpred,i.indrelid) AS predicate,
             ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true)
                   FROM generate_series(1,i.indnatts) k) AS columns
      FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
      JOIN pg_am am ON am.oid=ic.relam WHERE i.indrelid=expected_oid AND NOT i.indisprimary
    ) s;
    IF actual_signature IS DISTINCT FROM expected_signature THEN
      RAISE EXCEPTION 'Phase B index definition collision: %', table_name;
    END IF;
  END LOOP;
END
$phase_b_shape_guard$;

DROP SCHEMA "__phase_b_expected" CASCADE;

ALTER TABLE "ProjectFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectFeature" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FeatureContribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureContribution" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FeatureWorkLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureWorkLink" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RequirementBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequirementBinding" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GovernanceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GovernanceSnapshot" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProjectFeatureMutationReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectFeatureMutationReceipt" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  "ProjectFeature", "FeatureContribution", "FeatureWorkLink",
  "RequirementBinding", "GovernanceSnapshot",
  "ProjectFeatureMutationReceipt"
  FROM public, anon, authenticated, service_role, zuri_app_runtime, zuri_web_login;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "ProjectFeature", "FeatureContribution", "FeatureWorkLink",
  "RequirementBinding" TO zuri_app_runtime;
GRANT SELECT, INSERT ON TABLE
  "GovernanceSnapshot", "ProjectFeatureMutationReceipt" TO zuri_app_runtime;

-- These six tables have no pre-existing application policies in the additive
-- contract. Refuse an unknown policy instead of silently composing a weaker
-- OR branch with the policies below.
DO $phase_b_policy_name_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname='public' AND p.tablename IN ('GovernanceSnapshot','ProjectFeature','FeatureContribution','FeatureWorkLink','RequirementBinding','ProjectFeatureMutationReceipt')
      AND NOT EXISTS (SELECT 1 FROM (VALUES
        ('ProjectFeature','phase_b_project_feature'),
        ('FeatureContribution','phase_b_feature_contribution'),
        ('FeatureWorkLink','phase_b_feature_work_link'),
        ('RequirementBinding','phase_b_requirement_binding'),
        ('GovernanceSnapshot','phase_b_governance_snapshot_select'),
        ('GovernanceSnapshot','phase_b_governance_snapshot_insert'),
        ('ProjectFeatureMutationReceipt','phase_b_mutation_receipt_select'),
        ('ProjectFeatureMutationReceipt','phase_b_mutation_receipt_insert')
      ) expected(table_name,policy_name) WHERE p.tablename=expected.table_name AND p.policyname=expected.policy_name)
  ) THEN RAISE EXCEPTION 'Phase B unexpected table/policy binding; refusing policy composition'; END IF;
END
$phase_b_policy_name_guard$;

-- The policy body is inlined (rather than delegated to a role-only policy or
-- a generic scope function) so the parent hierarchy and optional snapshot pin
-- are part of the database backstop. On rerun, the existing policy is renamed
-- inside this transaction, the canonical definition is recreated, and the
-- parsed pg_policy definitions are compared before the old object is removed.
DO $phase_b_project_feature_guard$
DECLARE policy_was_present BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public."ProjectFeature"'::regclass AND polname='phase_b_project_feature')
    INTO policy_was_present;
  IF policy_was_present THEN
    ALTER POLICY "phase_b_project_feature" ON "ProjectFeature" RENAME TO "phase_b_project_feature__existing";
  END IF;
  EXECUTE $phase_b_project_feature_sql$
      CREATE POLICY "phase_b_project_feature"
        ON "ProjectFeature" FOR ALL TO zuri_app_runtime, zuri_web_login
        USING (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "ProjectFeature"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "ProjectFeature"."businessId" = current_setting('zuri.pm_business_id', true)
          AND EXISTS (
            SELECT 1
            FROM "Project" p
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            WHERE p."id" = "ProjectFeature"."projectId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = "ProjectFeature"."businessId"
              AND b."id" = "ProjectFeature"."businessId"
              AND b."tenantId" = "ProjectFeature"."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
          )
          AND (
            "ProjectFeature"."governanceSnapshotId" IS NULL
            OR EXISTS (
              SELECT 1
              FROM "GovernanceSnapshot" s
              JOIN "ProjectRepository" spr ON spr."id" = s."projectRepositoryId"
              JOIN "Repository" sr ON sr."id" = s."repositoryId"
              WHERE s."id" = "ProjectFeature"."governanceSnapshotId"
                AND s."tenantId" = "ProjectFeature"."tenantId"
                AND s."businessId" = "ProjectFeature"."businessId"
                AND s."validationStatus" = 'VALID'
                AND s."sourceManifest" IS NOT NULL
                AND spr."projectId" = "ProjectFeature"."projectId"
                AND spr."repoId" = sr."id"
                AND sr."businessId" = "ProjectFeature"."businessId"
            )
          )
        )
        WITH CHECK (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "ProjectFeature"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "ProjectFeature"."businessId" = current_setting('zuri.pm_business_id', true)
          AND EXISTS (
            SELECT 1
            FROM "Project" p
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            WHERE p."id" = "ProjectFeature"."projectId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = "ProjectFeature"."businessId"
              AND b."id" = "ProjectFeature"."businessId"
              AND b."tenantId" = "ProjectFeature"."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
          )
          AND (
            "ProjectFeature"."governanceSnapshotId" IS NULL
            OR EXISTS (
              SELECT 1
              FROM "GovernanceSnapshot" s
              JOIN "ProjectRepository" spr ON spr."id" = s."projectRepositoryId"
              JOIN "Repository" sr ON sr."id" = s."repositoryId"
              WHERE s."id" = "ProjectFeature"."governanceSnapshotId"
                AND s."tenantId" = "ProjectFeature"."tenantId"
                AND s."businessId" = "ProjectFeature"."businessId"
                AND s."validationStatus" = 'VALID'
                AND s."sourceManifest" IS NOT NULL
                AND spr."projectId" = "ProjectFeature"."projectId"
                AND spr."repoId" = sr."id"
                AND sr."businessId" = "ProjectFeature"."businessId"
            )
          )
         );
    $phase_b_project_feature_sql$;
  IF policy_was_present THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy actual JOIN pg_policy expected ON actual.polrelid=expected.polrelid
      WHERE actual.polrelid='public."ProjectFeature"'::regclass
        AND actual.polname='phase_b_project_feature__existing' AND expected.polname='phase_b_project_feature'
        AND actual.polcmd=expected.polcmd AND actual.polroles=expected.polroles
        AND actual.polpermissive=expected.polpermissive
        AND pg_get_expr(actual.polqual,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polqual,expected.polrelid)
        AND pg_get_expr(actual.polwithcheck,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polwithcheck,expected.polrelid)
    ) THEN RAISE EXCEPTION 'Phase B policy definition collision: phase_b_project_feature'; END IF;
    DROP POLICY "phase_b_project_feature__existing" ON "ProjectFeature";
  END IF;
END
$phase_b_project_feature_guard$;

DO $phase_b_feature_contribution_guard$
DECLARE policy_was_present BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public."FeatureContribution"'::regclass AND polname='phase_b_feature_contribution')
    INTO policy_was_present;
  IF policy_was_present THEN
    ALTER POLICY "phase_b_feature_contribution" ON "FeatureContribution" RENAME TO "phase_b_feature_contribution__existing";
  END IF;
  EXECUTE $phase_b_feature_contribution_sql$
      CREATE POLICY "phase_b_feature_contribution"
        ON "FeatureContribution" FOR ALL TO zuri_app_runtime, zuri_web_login
        USING (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "FeatureContribution"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "FeatureContribution"."businessId" = current_setting('zuri.pm_business_id', true)
          AND EXISTS (
            SELECT 1
            FROM "ProjectFeature" f
            JOIN "Project" p ON p."id" = f."projectId"
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            WHERE f."id" = "FeatureContribution"."featureId"
              AND f."tenantId" = "FeatureContribution"."tenantId"
              AND f."businessId" = "FeatureContribution"."businessId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = f."businessId"
              AND b."id" = f."businessId"
              AND b."tenantId" = f."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
          )
        )
        WITH CHECK (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "FeatureContribution"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "FeatureContribution"."businessId" = current_setting('zuri.pm_business_id', true)
          AND EXISTS (
            SELECT 1
            FROM "ProjectFeature" f
            JOIN "Project" p ON p."id" = f."projectId"
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            WHERE f."id" = "FeatureContribution"."featureId"
              AND f."tenantId" = "FeatureContribution"."tenantId"
              AND f."businessId" = "FeatureContribution"."businessId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = f."businessId"
              AND b."id" = f."businessId"
              AND b."tenantId" = f."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
          )
        );
    $phase_b_feature_contribution_sql$;
  IF policy_was_present THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy actual JOIN pg_policy expected ON actual.polrelid=expected.polrelid
      WHERE actual.polrelid='public."FeatureContribution"'::regclass
        AND actual.polname='phase_b_feature_contribution__existing' AND expected.polname='phase_b_feature_contribution'
        AND actual.polcmd=expected.polcmd AND actual.polroles=expected.polroles
        AND actual.polpermissive=expected.polpermissive
        AND pg_get_expr(actual.polqual,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polqual,expected.polrelid)
        AND pg_get_expr(actual.polwithcheck,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polwithcheck,expected.polrelid)
    ) THEN RAISE EXCEPTION 'Phase B policy definition collision: phase_b_feature_contribution'; END IF;
    DROP POLICY "phase_b_feature_contribution__existing" ON "FeatureContribution";
  END IF;
END
$phase_b_feature_contribution_guard$;

DO $phase_b_feature_work_link_guard$
DECLARE policy_was_present BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public."FeatureWorkLink"'::regclass AND polname='phase_b_feature_work_link')
    INTO policy_was_present;
  IF policy_was_present THEN
    ALTER POLICY "phase_b_feature_work_link" ON "FeatureWorkLink" RENAME TO "phase_b_feature_work_link__existing";
  END IF;
  EXECUTE $phase_b_feature_work_link_sql$
      CREATE POLICY "phase_b_feature_work_link"
        ON "FeatureWorkLink" FOR ALL TO zuri_app_runtime, zuri_web_login
        USING (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "FeatureWorkLink"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "FeatureWorkLink"."businessId" = current_setting('zuri.pm_business_id', true)
          AND EXISTS (
            SELECT 1
            FROM "ProjectFeature" f
            JOIN "Project" p ON p."id" = f."projectId"
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            JOIN "WorkItem" wi ON wi."id" = "FeatureWorkLink"."workItemId"
            JOIN "Workstream" ws ON ws."id" = wi."workstreamId"
            WHERE f."id" = "FeatureWorkLink"."featureId"
              AND f."tenantId" = "FeatureWorkLink"."tenantId"
              AND f."businessId" = "FeatureWorkLink"."businessId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = f."businessId"
              AND b."id" = f."businessId"
              AND b."tenantId" = f."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
              AND wi."deletedAt" IS NULL
              AND ws."projectId" = f."projectId"
              AND ws."deletedAt" IS NULL
              AND (
                wi."containerId" IS NULL
                OR EXISTS (
                  SELECT 1
                  FROM "WorkContainer" c
                  WHERE c."id" = wi."containerId"
                    AND c."workstreamId" = ws."id"
                )
              )
          )
        )
        WITH CHECK (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "FeatureWorkLink"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "FeatureWorkLink"."businessId" = current_setting('zuri.pm_business_id', true)
          AND EXISTS (
            SELECT 1
            FROM "ProjectFeature" f
            JOIN "Project" p ON p."id" = f."projectId"
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            JOIN "WorkItem" wi ON wi."id" = "FeatureWorkLink"."workItemId"
            JOIN "Workstream" ws ON ws."id" = wi."workstreamId"
            WHERE f."id" = "FeatureWorkLink"."featureId"
              AND f."tenantId" = "FeatureWorkLink"."tenantId"
              AND f."businessId" = "FeatureWorkLink"."businessId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = f."businessId"
              AND b."id" = f."businessId"
              AND b."tenantId" = f."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
              AND wi."deletedAt" IS NULL
              AND ws."projectId" = f."projectId"
              AND ws."deletedAt" IS NULL
              AND (
                wi."containerId" IS NULL
                OR EXISTS (
                  SELECT 1
                  FROM "WorkContainer" c
                  WHERE c."id" = wi."containerId"
                    AND c."workstreamId" = ws."id"
                )
              )
          )
        );
    $phase_b_feature_work_link_sql$;
  IF policy_was_present THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy actual JOIN pg_policy expected ON actual.polrelid=expected.polrelid
      WHERE actual.polrelid='public."FeatureWorkLink"'::regclass
        AND actual.polname='phase_b_feature_work_link__existing' AND expected.polname='phase_b_feature_work_link'
        AND actual.polcmd=expected.polcmd AND actual.polroles=expected.polroles
        AND actual.polpermissive=expected.polpermissive
        AND pg_get_expr(actual.polqual,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polqual,expected.polrelid)
        AND pg_get_expr(actual.polwithcheck,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polwithcheck,expected.polrelid)
    ) THEN RAISE EXCEPTION 'Phase B policy definition collision: phase_b_feature_work_link'; END IF;
    DROP POLICY "phase_b_feature_work_link__existing" ON "FeatureWorkLink";
  END IF;
END
$phase_b_feature_work_link_guard$;

DO $phase_b_requirement_binding_guard$
DECLARE policy_was_present BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public."RequirementBinding"'::regclass AND polname='phase_b_requirement_binding')
    INTO policy_was_present;
  IF policy_was_present THEN
    ALTER POLICY "phase_b_requirement_binding" ON "RequirementBinding" RENAME TO "phase_b_requirement_binding__existing";
  END IF;
  EXECUTE $phase_b_requirement_binding_sql$
      CREATE POLICY "phase_b_requirement_binding"
        ON "RequirementBinding" FOR ALL TO zuri_app_runtime, zuri_web_login
        USING (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "RequirementBinding"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "RequirementBinding"."businessId" = current_setting('zuri.pm_business_id', true)
          AND EXISTS (
            SELECT 1
            FROM "ProjectFeature" f
            JOIN "Project" p ON p."id" = f."projectId"
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            JOIN "GovernanceSnapshot" s
              ON s."id" = "RequirementBinding"."governanceSnapshotId"
            JOIN "ProjectRepository" spr ON spr."id" = s."projectRepositoryId"
            JOIN "Repository" sr ON sr."id" = s."repositoryId"
            WHERE f."id" = "RequirementBinding"."featureId"
              AND f."tenantId" = "RequirementBinding"."tenantId"
              AND f."businessId" = "RequirementBinding"."businessId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = f."businessId"
              AND b."id" = f."businessId"
              AND b."tenantId" = f."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
              AND s."tenantId" = "RequirementBinding"."tenantId"
              AND s."businessId" = "RequirementBinding"."businessId"
              AND s."validationStatus" = 'VALID'
              AND s."sourceManifest" IS NOT NULL
              AND spr."projectId" = f."projectId"
              AND spr."repoId" = sr."id"
              AND sr."businessId" = f."businessId"
          )
        )
        WITH CHECK (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "RequirementBinding"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "RequirementBinding"."businessId" = current_setting('zuri.pm_business_id', true)
          AND EXISTS (
            SELECT 1
            FROM "ProjectFeature" f
            JOIN "Project" p ON p."id" = f."projectId"
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            JOIN "GovernanceSnapshot" s
              ON s."id" = "RequirementBinding"."governanceSnapshotId"
            JOIN "ProjectRepository" spr ON spr."id" = s."projectRepositoryId"
            JOIN "Repository" sr ON sr."id" = s."repositoryId"
            WHERE f."id" = "RequirementBinding"."featureId"
              AND f."tenantId" = "RequirementBinding"."tenantId"
              AND f."businessId" = "RequirementBinding"."businessId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = f."businessId"
              AND b."id" = f."businessId"
              AND b."tenantId" = f."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
              AND s."tenantId" = "RequirementBinding"."tenantId"
              AND s."businessId" = "RequirementBinding"."businessId"
              AND s."validationStatus" = 'VALID'
              AND s."sourceManifest" IS NOT NULL
              AND spr."projectId" = f."projectId"
              AND spr."repoId" = sr."id"
              AND sr."businessId" = f."businessId"
          )
        );
    $phase_b_requirement_binding_sql$;
  IF policy_was_present THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy actual JOIN pg_policy expected ON actual.polrelid=expected.polrelid
      WHERE actual.polrelid='public."RequirementBinding"'::regclass
        AND actual.polname='phase_b_requirement_binding__existing' AND expected.polname='phase_b_requirement_binding'
        AND actual.polcmd=expected.polcmd AND actual.polroles=expected.polroles
        AND actual.polpermissive=expected.polpermissive
        AND pg_get_expr(actual.polqual,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polqual,expected.polrelid)
        AND pg_get_expr(actual.polwithcheck,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polwithcheck,expected.polrelid)
    ) THEN RAISE EXCEPTION 'Phase B policy definition collision: phase_b_requirement_binding'; END IF;
    DROP POLICY "phase_b_requirement_binding__existing" ON "RequirementBinding";
  END IF;
END
$phase_b_requirement_binding_guard$;

DO $phase_b_governance_snapshot_select_guard$
DECLARE policy_was_present BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public."GovernanceSnapshot"'::regclass AND polname='phase_b_governance_snapshot_select')
    INTO policy_was_present;
  IF policy_was_present THEN
    ALTER POLICY "phase_b_governance_snapshot_select" ON "GovernanceSnapshot" RENAME TO "phase_b_governance_snapshot_select__existing";
  END IF;
  EXECUTE $phase_b_governance_snapshot_select_sql$
      CREATE POLICY "phase_b_governance_snapshot_select"
        ON "GovernanceSnapshot" FOR SELECT TO zuri_app_runtime, zuri_web_login
        USING (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "GovernanceSnapshot"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "GovernanceSnapshot"."businessId" = current_setting('zuri.pm_business_id', true)
          AND "GovernanceSnapshot"."validationStatus" = 'VALID'
          AND "GovernanceSnapshot"."sourceManifest" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "ProjectRepository" pr
            JOIN "Repository" r ON r."id" = pr."repoId"
            JOIN "Project" p ON p."id" = pr."projectId"
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            WHERE pr."id" = "GovernanceSnapshot"."projectRepositoryId"
              AND pr."repoId" = "GovernanceSnapshot"."repositoryId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = "GovernanceSnapshot"."businessId"
              AND r."businessId" = "GovernanceSnapshot"."businessId"
              AND b."id" = "GovernanceSnapshot"."businessId"
              AND b."tenantId" = "GovernanceSnapshot"."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
          )
        );
    $phase_b_governance_snapshot_select_sql$;
  IF policy_was_present THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy actual JOIN pg_policy expected ON actual.polrelid=expected.polrelid
      WHERE actual.polrelid='public."GovernanceSnapshot"'::regclass
        AND actual.polname='phase_b_governance_snapshot_select__existing' AND expected.polname='phase_b_governance_snapshot_select'
        AND actual.polcmd=expected.polcmd AND actual.polroles=expected.polroles
        AND actual.polpermissive=expected.polpermissive
        AND pg_get_expr(actual.polqual,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polqual,expected.polrelid)
        AND pg_get_expr(actual.polwithcheck,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polwithcheck,expected.polrelid)
    ) THEN RAISE EXCEPTION 'Phase B policy definition collision: phase_b_governance_snapshot_select'; END IF;
    DROP POLICY "phase_b_governance_snapshot_select__existing" ON "GovernanceSnapshot";
  END IF;
END
$phase_b_governance_snapshot_select_guard$;

DO $phase_b_governance_snapshot_insert_guard$
DECLARE policy_was_present BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public."GovernanceSnapshot"'::regclass AND polname='phase_b_governance_snapshot_insert')
    INTO policy_was_present;
  IF policy_was_present THEN
    ALTER POLICY "phase_b_governance_snapshot_insert" ON "GovernanceSnapshot" RENAME TO "phase_b_governance_snapshot_insert__existing";
  END IF;
  EXECUTE $phase_b_governance_snapshot_insert_sql$
      CREATE POLICY "phase_b_governance_snapshot_insert"
        ON "GovernanceSnapshot" FOR INSERT TO zuri_app_runtime, zuri_web_login
        WITH CHECK (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "GovernanceSnapshot"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "GovernanceSnapshot"."businessId" = current_setting('zuri.pm_business_id', true)
          AND "GovernanceSnapshot"."validationStatus" = 'VALID'
          AND "GovernanceSnapshot"."sourceManifest" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "ProjectRepository" pr
            JOIN "Repository" r ON r."id" = pr."repoId"
            JOIN "Project" p ON p."id" = pr."projectId"
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            WHERE pr."id" = "GovernanceSnapshot"."projectRepositoryId"
              AND pr."repoId" = "GovernanceSnapshot"."repositoryId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = "GovernanceSnapshot"."businessId"
              AND r."businessId" = "GovernanceSnapshot"."businessId"
              AND b."id" = "GovernanceSnapshot"."businessId"
              AND b."tenantId" = "GovernanceSnapshot"."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
          )
        );
    $phase_b_governance_snapshot_insert_sql$;
  IF policy_was_present THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy actual JOIN pg_policy expected ON actual.polrelid=expected.polrelid
      WHERE actual.polrelid='public."GovernanceSnapshot"'::regclass
        AND actual.polname='phase_b_governance_snapshot_insert__existing' AND expected.polname='phase_b_governance_snapshot_insert'
        AND actual.polcmd=expected.polcmd AND actual.polroles=expected.polroles
        AND actual.polpermissive=expected.polpermissive
        AND pg_get_expr(actual.polqual,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polqual,expected.polrelid)
        AND pg_get_expr(actual.polwithcheck,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polwithcheck,expected.polrelid)
    ) THEN RAISE EXCEPTION 'Phase B policy definition collision: phase_b_governance_snapshot_insert'; END IF;
    DROP POLICY "phase_b_governance_snapshot_insert__existing" ON "GovernanceSnapshot";
  END IF;
END
$phase_b_governance_snapshot_insert_guard$;

DO $phase_b_mutation_receipt_select_guard$
DECLARE policy_was_present BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public."ProjectFeatureMutationReceipt"'::regclass AND polname='phase_b_mutation_receipt_select')
    INTO policy_was_present;
  IF policy_was_present THEN
    ALTER POLICY "phase_b_mutation_receipt_select" ON "ProjectFeatureMutationReceipt" RENAME TO "phase_b_mutation_receipt_select__existing";
  END IF;
  EXECUTE $phase_b_mutation_receipt_select_sql$
      CREATE POLICY "phase_b_mutation_receipt_select"
        ON "ProjectFeatureMutationReceipt" FOR SELECT TO zuri_app_runtime, zuri_web_login
        USING (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "ProjectFeatureMutationReceipt"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "ProjectFeatureMutationReceipt"."businessId" = current_setting('zuri.pm_business_id', true)
          AND "ProjectFeatureMutationReceipt"."status" = 'COMMITTED'
          AND "ProjectFeatureMutationReceipt"."etag" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "Project" p
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            WHERE p."id" = "ProjectFeatureMutationReceipt"."projectId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              AND b."id" = "ProjectFeatureMutationReceipt"."businessId"
              AND b."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM "AuditEvent" a
            WHERE a."id" = "ProjectFeatureMutationReceipt"."auditEventId"
              AND a."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
              AND a."businessId" = "ProjectFeatureMutationReceipt"."businessId"
          )
          AND (
            (
              "ProjectFeatureMutationReceipt"."operation" = 'CREATE_FEATURE'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'UPDATE_FEATURE'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PATCH'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" IN ('REPLACE_CONTRIBUTIONS', 'REPLACE_WORK_LINKS', 'REPLACE_REQUIREMENT_BINDINGS')
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PUT'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'REPLACE_FEATURE_WORK_GRAPH'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PUT'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE_GRAPH'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."projectId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NULL
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'DELETE_FEATURE'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'DELETE'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'RESTORE_FEATURE'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'CAPTURE_GOVERNANCE_SNAPSHOT'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'GOVERNANCE_SNAPSHOT'
              AND "ProjectFeatureMutationReceipt"."featureId" IS NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NULL
              AND EXISTS (
                SELECT 1
                FROM "GovernanceSnapshot" s
                JOIN "ProjectRepository" pr ON pr."id" = s."projectRepositoryId"
                JOIN "Repository" r ON r."id" = s."repositoryId"
                WHERE s."id" = "ProjectFeatureMutationReceipt"."resourceId"
                  AND s."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                  AND s."businessId" = "ProjectFeatureMutationReceipt"."businessId"
                  AND s."validationStatus" = 'VALID'
                  AND s."sourceManifest" IS NOT NULL
                  AND pr."id" = s."projectRepositoryId"
                  AND pr."repoId" = r."id"
                  AND pr."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                  AND r."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
          )
        );
    $phase_b_mutation_receipt_select_sql$;
  IF policy_was_present THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy actual JOIN pg_policy expected ON actual.polrelid=expected.polrelid
      WHERE actual.polrelid='public."ProjectFeatureMutationReceipt"'::regclass
        AND actual.polname='phase_b_mutation_receipt_select__existing' AND expected.polname='phase_b_mutation_receipt_select'
        AND actual.polcmd=expected.polcmd AND actual.polroles=expected.polroles
        AND actual.polpermissive=expected.polpermissive
        AND pg_get_expr(actual.polqual,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polqual,expected.polrelid)
        AND pg_get_expr(actual.polwithcheck,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polwithcheck,expected.polrelid)
    ) THEN RAISE EXCEPTION 'Phase B policy definition collision: phase_b_mutation_receipt_select'; END IF;
    DROP POLICY "phase_b_mutation_receipt_select__existing" ON "ProjectFeatureMutationReceipt";
  END IF;
END
$phase_b_mutation_receipt_select_guard$;

DO $phase_b_mutation_receipt_insert_guard$
DECLARE policy_was_present BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public."ProjectFeatureMutationReceipt"'::regclass AND polname='phase_b_mutation_receipt_insert')
    INTO policy_was_present;
  IF policy_was_present THEN
    ALTER POLICY "phase_b_mutation_receipt_insert" ON "ProjectFeatureMutationReceipt" RENAME TO "phase_b_mutation_receipt_insert__existing";
  END IF;
  EXECUTE $phase_b_mutation_receipt_insert_sql$
      CREATE POLICY "phase_b_mutation_receipt_insert"
        ON "ProjectFeatureMutationReceipt" FOR INSERT TO zuri_app_runtime, zuri_web_login
        WITH CHECK (
          NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
          AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
          AND "ProjectFeatureMutationReceipt"."tenantId" = current_setting('zuri.pm_tenant_id', true)
          AND "ProjectFeatureMutationReceipt"."businessId" = current_setting('zuri.pm_business_id', true)
          AND "ProjectFeatureMutationReceipt"."status" = 'COMMITTED'
          AND "ProjectFeatureMutationReceipt"."etag" IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "Project" p
            JOIN "Workspace" w ON w."id" = p."workspaceId"
            JOIN "Business" b ON b."id" = p."businessId"
            JOIN "Tenant" t ON t."id" = b."tenantId"
            WHERE p."id" = "ProjectFeatureMutationReceipt"."projectId"
              AND p."businessId" IS NOT NULL
              AND p."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              AND b."id" = "ProjectFeatureMutationReceipt"."businessId"
              AND b."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
              AND (
                (
                  w."scopeType" = 'BUSINESS'
                  AND w."businessId" = p."businessId"
                  AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
                )
                OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
                OR (
                  w."scopeType" = 'PORTFOLIO'
                  AND w."tenantId" = t."id"
                  AND w."portfolioId" = t."portfolioId"
                )
              )
              AND p."deletedAt" IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM "AuditEvent" a
            WHERE a."id" = "ProjectFeatureMutationReceipt"."auditEventId"
              AND a."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
              AND a."businessId" = "ProjectFeatureMutationReceipt"."businessId"
          )
          AND (
            (
              "ProjectFeatureMutationReceipt"."operation" = 'CREATE_FEATURE'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'UPDATE_FEATURE'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PATCH'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" IN ('REPLACE_CONTRIBUTIONS', 'REPLACE_WORK_LINKS', 'REPLACE_REQUIREMENT_BINDINGS')
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PUT'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'REPLACE_FEATURE_WORK_GRAPH'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PUT'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE_GRAPH'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."projectId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NULL
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'DELETE_FEATURE'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'DELETE'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'RESTORE_FEATURE'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
              AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
              AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NOT NULL
              AND "ProjectFeatureMutationReceipt"."version" >= 1
              AND EXISTS (
                SELECT 1 FROM "ProjectFeature" f
                 WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
                   AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                   AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                   AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
            OR (
              "ProjectFeatureMutationReceipt"."operation" = 'CAPTURE_GOVERNANCE_SNAPSHOT'
              AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
              AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
              AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
              AND "ProjectFeatureMutationReceipt"."resourceType" = 'GOVERNANCE_SNAPSHOT'
              AND "ProjectFeatureMutationReceipt"."featureId" IS NULL
              AND "ProjectFeatureMutationReceipt"."version" IS NULL
              AND EXISTS (
                SELECT 1
                FROM "GovernanceSnapshot" s
                JOIN "ProjectRepository" pr ON pr."id" = s."projectRepositoryId"
                JOIN "Repository" r ON r."id" = s."repositoryId"
                WHERE s."id" = "ProjectFeatureMutationReceipt"."resourceId"
                  AND s."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
                  AND s."businessId" = "ProjectFeatureMutationReceipt"."businessId"
                  AND s."validationStatus" = 'VALID'
                  AND s."sourceManifest" IS NOT NULL
                  AND pr."id" = s."projectRepositoryId"
                  AND pr."repoId" = r."id"
                  AND pr."projectId" = "ProjectFeatureMutationReceipt"."projectId"
                  AND r."businessId" = "ProjectFeatureMutationReceipt"."businessId"
              )
            )
          )
        );
    $phase_b_mutation_receipt_insert_sql$;
  IF policy_was_present THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy actual JOIN pg_policy expected ON actual.polrelid=expected.polrelid
      WHERE actual.polrelid='public."ProjectFeatureMutationReceipt"'::regclass
        AND actual.polname='phase_b_mutation_receipt_insert__existing' AND expected.polname='phase_b_mutation_receipt_insert'
        AND actual.polcmd=expected.polcmd AND actual.polroles=expected.polroles
        AND actual.polpermissive=expected.polpermissive
        AND pg_get_expr(actual.polqual,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polqual,expected.polrelid)
        AND pg_get_expr(actual.polwithcheck,actual.polrelid) IS NOT DISTINCT FROM pg_get_expr(expected.polwithcheck,expected.polrelid)
    ) THEN RAISE EXCEPTION 'Phase B policy definition collision: phase_b_mutation_receipt_insert'; END IF;
    DROP POLICY "phase_b_mutation_receipt_insert__existing" ON "ProjectFeatureMutationReceipt";
  END IF;
END
$phase_b_mutation_receipt_insert_guard$;

-- No UPDATE/DELETE policy or runtime grant exists for either immutable table.
-- Replay is a service transaction that reads the committed receipt and returns
-- a fresh transport request id; it never changes this row.
COMMIT;
