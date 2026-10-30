// @spec ADR-115, ADR-045, ADR-097 — fresh-only security snapshot; never a migration-history runner.
// @tested tests/postgres/compact-fresh-install.test.js
// Phase B CHECKs and eight policy expressions are copied exactly from the issued source below.
// Runtime-only generic policies preserve server-owned access; every table is forced through RLS.
export const PHASE_B_SOURCE = Object.freeze({ file: 'supabase/migrations/20260917041000_add_phase_b_feature_authority.sql', sha256: '9cdc9dec66a479b55238488e4bc8e14b637bb9ca9af2e7671aa5a382767d60c3', checks: 79, policies: 8 })
import { COMPACT_MARKETING_SECURITY_SQL } from './marketing-security.mjs'
export const COMPACT_CORE_SECURITY_SQL = String.raw`
CREATE ROLE zuri_app_runtime NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE zuri_web_login LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT zuri_app_runtime TO zuri_web_login WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO zuri_app_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $compact_runtime$
DECLARE r record;
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC',current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO zuri_app_runtime',current_database());
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',r.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,zuri_app_runtime,zuri_web_login',r.tablename);
    IF r.tablename IN ('GovernanceSnapshot','ProjectFeatureMutationReceipt','PricingCalculation','MarketingExternalReport') THEN
      EXECUTE format('GRANT SELECT,INSERT ON TABLE public.%I TO zuri_app_runtime',r.tablename);
    ELSIF r.tablename IN ('PricingRuleSet','MarketingReportPolicy','MarketingReportBinding') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE ON TABLE public.%I TO zuri_app_runtime',r.tablename);
    ELSE
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO zuri_app_runtime',r.tablename);
    END IF;
    IF r.tablename NOT IN ('GovernanceSnapshot','ProjectFeature','FeatureContribution','FeatureWorkLink','RequirementBinding','ProjectFeatureMutationReceipt') THEN
      EXECUTE format('CREATE POLICY zuri_app_runtime_all ON public.%I FOR ALL TO zuri_app_runtime,zuri_web_login USING (true) WITH CHECK (true)',r.tablename);
    END IF;
  END LOOP;
END $compact_runtime$;
GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA public TO zuri_app_runtime;

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_repositoryId_uuid_check" CHECK ("repositoryId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_projectRepositoryId_uuid_check" CHECK ("projectRepositoryId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_proofId_uuid_check" CHECK ("proofId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_checkoutBindingId_bounds" CHECK (length("checkoutBindingId") BETWEEN 1 AND 256);

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_commitSha_bounds" CHECK ("commitSha" ~ '^[a-f0-9]{40}([a-f0-9]{24})?$');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_manifestHash_sha256" CHECK ("manifestHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_verifierId_bounds" CHECK (length("verifierId") BETWEEN 1 AND 128);

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_verifierVersion_bounds" CHECK (length("verifierVersion") BETWEEN 1 AND 64);

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_verificationProof_object" CHECK (jsonb_typeof("verificationProof"::jsonb) = 'object');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_validationStatus_check" CHECK ("validationStatus" = 'VALID');

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_sourceManifest_bounds" CHECK (octet_length("sourceManifest") BETWEEN 1 AND 1048576);

ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_sourceManifest_object" CHECK (jsonb_typeof("sourceManifest"::jsonb) = 'object');

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_projectId_uuid_check" CHECK ("projectId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_governanceSnapshotId_uuid_check" CHECK ("governanceSnapshotId" IS NULL OR "governanceSnapshotId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_code_bounds" CHECK (length("code") BETWEEN 1 AND 128);

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_title_bounds" CHECK (length("title") BETWEEN 1 AND 500);

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_problem_bounds" CHECK (length("problem") BETWEEN 1 AND 5000);

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_outcome_bounds" CHECK (length("outcome") BETWEEN 1 AND 5000);

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_primaryDomainId_bounds" CHECK (length("primaryDomainId") BETWEEN 1 AND 128);

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_canonicalFeatureKey_bounds" CHECK ("canonicalFeatureKey" IS NULL OR length("canonicalFeatureKey") BETWEEN 1 AND 200);

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_canonicalPair_check" CHECK (("canonicalFeatureKey" IS NULL AND "governanceSnapshotId" IS NULL) OR ("canonicalFeatureKey" IS NOT NULL AND "governanceSnapshotId" IS NOT NULL));

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_lifecycle_check" CHECK ("lifecycle" IN ('DRAFT', 'ACTIVE', 'RETIRED'));

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_version_check" CHECK ("version" >= 1);

ALTER TABLE "ProjectFeature" ADD CONSTRAINT "ProjectFeature_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL));

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_domainId_bounds" CHECK (length("domainId") BETWEEN 1 AND 128);

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_responsibility_bounds" CHECK (length("responsibility") BETWEEN 1 AND 2000);

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_version_check" CHECK ("version" >= 1);

ALTER TABLE "FeatureContribution" ADD CONSTRAINT "FeatureContribution_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL));

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_workItemId_uuid_check" CHECK ("workItemId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_allocationBps_check" CHECK ("allocationBps" IS NULL OR "allocationBps" BETWEEN 0 AND 10000);

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_version_check" CHECK ("version" >= 1);

ALTER TABLE "FeatureWorkLink" ADD CONSTRAINT "FeatureWorkLink_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL));

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_featureId_uuid_check" CHECK ("featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_governanceSnapshotId_uuid_check" CHECK ("governanceSnapshotId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_deleteBatchId_uuid_check" CHECK ("deleteBatchId" IS NULL OR "deleteBatchId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_sourceNamespace_bounds" CHECK (length("sourceNamespace") BETWEEN 1 AND 128);

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_requirementKey_bounds" CHECK (length("requirementKey") BETWEEN 1 AND 128);

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_revisionHash_sha256" CHECK ("revisionHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_acceptanceRef_bounds" CHECK (length("acceptanceRef") BETWEEN 1 AND 1000);

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_version_check" CHECK ("version" >= 1);

ALTER TABLE "RequirementBinding" ADD CONSTRAINT "RequirementBinding_deletePair_check" CHECK (("deletedAt" IS NULL AND "deleteBatchId" IS NULL) OR ("deletedAt" IS NOT NULL AND "deleteBatchId" IS NOT NULL));

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_id_uuid_check" CHECK ("id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_tenantId_uuid_check" CHECK ("tenantId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_businessId_uuid_check" CHECK ("businessId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_projectId_uuid_check" CHECK ("projectId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_featureId_uuid_check" CHECK ("featureId" IS NULL OR "featureId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_targetId_uuid_check" CHECK ("targetId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_principalId_uuid_check" CHECK ("principalId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_resourceId_uuid_check" CHECK ("resourceId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_auditEventId_uuid_check" CHECK ("auditEventId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_targetType_check" CHECK ("targetType" IN ('FEATURE', 'PROJECT'));

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_httpMethod_check" CHECK ("httpMethod" IN ('POST', 'PATCH', 'PUT', 'DELETE'));

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_operation_check" CHECK ("operation" IN ('CREATE_FEATURE', 'UPDATE_FEATURE', 'REPLACE_CONTRIBUTIONS', 'REPLACE_WORK_LINKS', 'REPLACE_FEATURE_WORK_GRAPH', 'REPLACE_REQUIREMENT_BINDINGS', 'DELETE_FEATURE', 'RESTORE_FEATURE', 'CAPTURE_GOVERNANCE_SNAPSHOT'));

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_idempotencyKey_bounds" CHECK (length("idempotencyKey") BETWEEN 8 AND 128);

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_payloadHash_sha256" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_resourceType_check" CHECK ("resourceType" IN ('PROJECT_FEATURE', 'PROJECT_FEATURE_GRAPH', 'GOVERNANCE_SNAPSHOT'));

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_etag_bounds" CHECK (length("etag") BETWEEN 1 AND 4096);

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_status_check" CHECK ("status" = 'COMMITTED');

ALTER TABLE "ProjectFeatureMutationReceipt" ADD CONSTRAINT "ProjectFeatureMutationReceipt_tuple_check" CHECK (
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
  );

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

-- Additional current public-model CHECK contracts (no backfill/history statements).
-- Source: supabase/migrations/20260912120000_access_grant_lifecycle.sql
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_scope_shape_check" CHECK (
  ("scopeType" = 'TENANT'   AND "businessId" IS NULL) OR
  ("scopeType" = 'BUSINESS' AND "businessId" IS NOT NULL));

-- Source: supabase/migrations/20260912120000_access_grant_lifecycle.sql
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_status_check" CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED'));

-- Source: supabase/migrations/20260912120000_access_grant_lifecycle.sql
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_role_check" CHECK (role IN ('OWNER','MEMBER'));

-- Source: supabase/migrations/20260912120000_access_grant_lifecycle.sql
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_grantSource_check" CHECK ("grantSource" IN ('ADMIN','INVITE','SELF_PROVISION','SEED','MIGRATION'));

-- Source: supabase/migrations/20260912120000_access_grant_lifecycle.sql
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_revoked_shape_check" CHECK ((status = 'REVOKED') = ("revokedAt" IS NOT NULL));

-- Source: supabase/migrations/20260912120000_access_grant_lifecycle.sql
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_suspended_shape_check" CHECK (status <> 'SUSPENDED' OR "suspendedAt" IS NOT NULL);

-- Source: supabase/migrations/20260912130000_org_employment_legal_entity.sql
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_status_check" CHECK (status IN ('ACTIVE', 'ARCHIVED'));

-- Source: supabase/migrations/20260912130000_org_employment_legal_entity.sql
ALTER TABLE "TaxRegistrationBranch" ADD CONSTRAINT "TaxRegistrationBranch_branchCode_check" CHECK ("branchCode" ~ '^[0-9]{5}$');

-- Source: supabase/migrations/20260912130000_org_employment_legal_entity.sql
ALTER TABLE "TaxRegistrationBranch" ADD CONSTRAINT "TaxRegistrationBranch_status_check" CHECK (status IN ('ACTIVE', 'ARCHIVED'));

-- Source: supabase/migrations/20260912130000_org_employment_legal_entity.sql
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_kind_check" CHECK (kind IN ('SITE', 'WAREHOUSE', 'KITCHEN', 'OFFICE'));

-- Source: supabase/migrations/20260912130000_org_employment_legal_entity.sql
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_employmentType_check" CHECK ("employmentType" IN ('EMPLOYEE', 'CONTRACTOR', 'INTERN', 'OWNER_OPERATOR'));

-- Source: supabase/migrations/20260912130000_org_employment_legal_entity.sql
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_status_check" CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'ENDED'));

-- Source: supabase/migrations/20260912130000_org_employment_legal_entity.sql
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_dates_check" CHECK ("endAt" IS NULL OR "startAt" IS NULL OR "endAt" >= "startAt");

-- Source: supabase/migrations/20260912140000_access_invite_sod_operator.sql
ALTER TABLE "AccessInvite" ADD CONSTRAINT "AccessInvite_status_check" CHECK (status IN ('PENDING','ACCEPTED','DECLINED','REVOKED'));

-- Source: supabase/migrations/20260912140000_access_invite_sod_operator.sql
ALTER TABLE "AccessInvite" ADD CONSTRAINT "AccessInvite_role_check" CHECK (role IN ('OWNER','ADMIN','MEMBER'));

-- Source: supabase/migrations/20260912140000_access_invite_sod_operator.sql
ALTER TABLE "AccessInvite" ADD CONSTRAINT "AccessInvite_scope_shape_check" CHECK (
  ("scopeType" = 'PORTFOLIO' AND "portfolioId" IS NOT NULL AND "tenantId" IS NULL     AND "businessId" IS NULL) OR
  ("scopeType" = 'TENANT'    AND "portfolioId" IS NULL     AND "tenantId" IS NOT NULL AND "businessId" IS NULL) OR
  ("scopeType" = 'BUSINESS'  AND "portfolioId" IS NULL     AND "tenantId" IS NOT NULL AND "businessId" IS NOT NULL));

-- Source: supabase/migrations/20260912140000_access_invite_sod_operator.sql
ALTER TABLE "AccessInvite" ADD CONSTRAINT "AccessInvite_addressee_check" CHECK (
  num_nonnulls("targetPersonId","invitedEmail","invitedLineUserId") >= 1);

-- Source: supabase/migrations/20260912140000_access_invite_sod_operator.sql
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_scope_shape_check" CHECK (
  ("scopeType" = 'BUSINESS' AND "businessId" IS NOT NULL) OR
  ("scopeType" = 'TENANT'   AND "businessId" IS NULL) OR
  ("scopeType" = 'BRANCH'));

-- Source: supabase/migrations/20260916090000_crm_conversation_sessions.sql
ALTER TABLE "LineOaAccount" ADD CONSTRAINT "LineOaAccount_sessionIdleTimeoutMinutes_range" CHECK ("sessionIdleTimeoutMinutes" BETWEEN 10 AND 120);

-- Source: supabase/migrations/20261012120000_business_kpis.sql
ALTER TABLE "BusinessKpi" ADD CHECK ("perspective" IN ('FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'LEARNING_GROWTH'));

-- Source: supabase/migrations/20261012120000_business_kpis.sql
ALTER TABLE "BusinessKpi" ADD CHECK ("direction" IN ('UP', 'DOWN'));

-- Source: supabase/migrations/20261012120000_business_kpis.sql
ALTER TABLE "BusinessKpi" ADD CHECK ("cadence" IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'));

-- Source: supabase/migrations/20261012120000_business_kpis.sql
ALTER TABLE "BusinessKpi" ADD CHECK ("status" IN ('ACTIVE', 'ARCHIVED'));

-- Source: supabase/migrations/20261012120000_business_kpis.sql
ALTER TABLE "BusinessKpi" ADD CONSTRAINT "BusinessKpi_warningThreshold_check" CHECK (("direction" = 'UP' AND "warningThreshold" < "target") OR ("direction" = 'DOWN' AND "warningThreshold" > "target"));

-- Source: supabase/migrations/20261015003000_business_agent_config.sql
ALTER TABLE "BusinessAgentConfig" ADD CONSTRAINT "BusinessAgentConfig_versions_check" CHECK ("templateVersion" > 0 AND "version" > 0);

-- Source: supabase/migrations/20261015003000_business_agent_config.sql
ALTER TABLE "BusinessAgentConfig" ADD CONSTRAINT "BusinessAgentConfig_delegationPolicy_check" CHECK ("delegationPolicy" = 'DENY');

-- Source: supabase/migrations/20261015003000_business_agent_config.sql
ALTER TABLE "BusinessAgentConfig" ADD CONSTRAINT "BusinessAgentConfig_snapshotDigest_check" CHECK ("snapshotDigest" ~ '^[0-9a-f]{64}$');

-- Source: supabase/migrations/20261015010000_standard_business_provisioning.sql
ALTER TABLE "Business" ADD CONSTRAINT "Business_provisioning_markers_check" CHECK (
        (
          "provisioningTemplateId" IS NULL AND
          "provisioningTemplateVersion" IS NULL AND
          "provisioningTemplateDigest" IS NULL AND
          "provisioningSnapshotJson" IS NULL
        ) OR (
          "provisioningTemplateId" IS NOT NULL AND
          "provisioningTemplateVersion" IS NOT NULL AND
          "provisioningTemplateDigest" IS NOT NULL AND
          "provisioningSnapshotJson" IS NOT NULL AND
          "provisioningTemplateId" = 'standard-business' AND
          "provisioningTemplateVersion" = '1.0.0' AND
          "provisioningTemplateDigest" ~ '^[0-9a-f]{64}$' AND
          jsonb_typeof("provisioningSnapshotJson"::jsonb) = 'object'
        )
      );

-- Source: supabase/migrations/20261015010000_standard_business_provisioning.sql
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_provisioning_key_scope_check" CHECK (
        "provisioningKey" IS NULL OR (
          "provisioningKey" = 'STANDARD_DEFAULT' AND
          "scopeType" = 'BUSINESS' AND
          "businessId" IS NOT NULL AND
          "tenantId" IS NOT NULL AND
          "portfolioId" IS NOT NULL
        )
      );
`

// Build-time source inventory: additions/edits require snapshot reconciliation.
export const COMPACT_SECURITY_SQL = COMPACT_CORE_SECURITY_SQL + COMPACT_MARKETING_SECURITY_SQL
export const CURRENT_SCHEMA_CONTRACTS = Object.freeze({
  "supabase/migrations/20260813192826_business_knowledge.sql": "192bc3a4be2e70848449d414aa18dae4dcb38430f77a072fa070a4282ce0edca",
  "supabase/migrations/20260813213654_production_tenant_bootstrap.sql": "82b28e8fc37a0daac05f1be22b1c857444f05c88ab6ebfd07dc0905689186b0c",
  "supabase/migrations/20260814023027_controlled_line_activation.sql": "21be72bd30dadac069764db4a028a1c22e7e5c29f89457fb4a27611158062d19",
  "supabase/migrations/20260818040000_phase1_line_runtime_connections.sql": "dd587716abd181182704f758ec94e2d9585a039020459c96c2d59925c6ac9e91",
  "supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql": "c9d25cbba46b9dc2a98968fe23d62d9ea32d0ea419d3b3880b3a895da707be3b",
  "supabase/migrations/20260818060000_customer_wannapa_identity_and_smartgift_cutover.sql": "146d156731ba066eeb27e7acd51bdd5f5b39d1ee1b6c04febbba251aadb2ab9b",
  "supabase/migrations/20260818070000_customer_profile_backfill_schema.sql": "f2ad1617d2c8d0e2481f483975875d1a7904904b2209b692d5580acf2ac7d94e",
  "supabase/migrations/20260818071000_platform_approver_profile.sql": "ed67b64e3e4398fe3cebe381aad6d1d8e0b290d5457a68e0d7024e5248bf2745",
  "supabase/migrations/20260818072000_customer_profile_contract_receipt.sql": "536343a71c4b840ec0114d3f2cc793b9ca9ef7929a977e274d79270fe66ed3de",
  "supabase/migrations/20260818073000_customer_import_review_queue.sql": "5845c1d6e4a9a66cdebb020ab8ed9dd7c7b22df884189835bb2e6b63a51a0045",
  "supabase/migrations/20260818084011_application_schema.sql": "d718b12b42bb742b9791ffe9d3c6ddd41227c9bac49258e74e9dbe54ded0a06d",
  "supabase/migrations/20260818084047_application_smartgift_identity.sql": "f944c999530cf0e0c08ee92a499a28522134e518098d8ea624fb6d5cf9b3988f",
  "supabase/migrations/20260818090201_customer_review_runtime_login.sql": "7a788ac8f6d341ac3591fe1343cb76868ee07f29293c6f50265d3b95f49fb433",
  "supabase/migrations/20260819120000_scope_external_ids_by_tenant.sql": "b954ecb2d7ed8864905a59a1f54c7332972c927a8bf4a56c8ccd548f411b87b5",
  "supabase/migrations/20260819161900_projects_dashboard_team_and_project_priority.sql": "b0d9ae3e005fd082cade761875b43b3fe581fa0f048fb39f85bcc95b5c8d0ae8",
  "supabase/migrations/20260820080000_market_observation.sql": "011390a9ba0b8e8cefa32fa02d7808bfcbbba59d448d840d3fef7cf19bc84e27",
  "supabase/migrations/20260820212547_smartgift_document_intake_connection.sql": "3a0a4932d696fae1704a6c0640af0465c2c91b40a59c138a28e44caf183279d2",
  "supabase/migrations/20260820221703_smartgift_pipeline_tracking.sql": "5413713aa212fc825b6b51a79186c718fa6e3f62b6850c77f1bc857f621ea145",
  "supabase/migrations/20260821103000_public_rls_hardening.sql": "8aa19c8ac770887b46ad3d59d0a21b0496343779518f43879da4daaf3db73108",
  "supabase/migrations/20260822195424_canonical_iam_phase0.sql": "9bd720c9f576ba771d6ea0cadb30f169a03d635290c9819f46c11a1fbce4a663",
  "supabase/migrations/20260822204604_canonical_iam_runtime_role_cutover.sql": "c07a17a6d96d57669f6dc7c0c02b3847ad1efb5f9a410d0cb7d98959c706df01",
  "supabase/migrations/20260824120000_sot_data_plane_key.sql": "aa7ea5dcc2ef603d9aa1865c0c47d4b5369a51fc9fb2c11b7fb8a8af479cdf54",
  "supabase/migrations/20260825130000_sot_decision.sql": "f8f2e3c6100747dad6f55e2d3be5a18dee55b1903ebf8fc33b5ac6064658e52f",
  "supabase/migrations/20260826080000_customer_consent.sql": "90866d86c52d371ec93f0edd48ee2bcbc127a5d48fb365d66708db1fb06eab1c",
  "supabase/migrations/20260826130000_workspace_onboarding.sql": "897ba6570436caa1e162fb853a43bce9e16456ce514debec42bcdd229e02469a",
  "supabase/migrations/20260826150000_api_access_key.sql": "a1683b98a6d0d7be04026533321e480a728d64a816c11bcb1a3e631e7d2b9029",
  "supabase/migrations/20260827090000_platform_grant.sql": "a8788c78fc976a53867412f72b095cfeb0a01f2516a9021c1cc7662290463018",
  "supabase/migrations/20260829120000_profile_identity_fields.sql": "2e52b80c5526bf2593f660589b1a582b5ce84c3b351bbbd9637ec555796fddb0",
  "supabase/migrations/20260830120000_plugin_auth.sql": "43bbe64ec850d68b0a489b7c63ca644509994144f6cea27c2cac7ffaa57e0b46",
  "supabase/migrations/20260830221729_conversation_analysis.sql": "eb288198ceb617e9d629c181e87e3606c77baaf6c8cef399a62dd95960b66fb0",
  "supabase/migrations/20260902001000_asset_management_foundation.sql": "d2bbbc7a561f4f02dfa591fa8ca75edc46d5a93ee09c834d7dc3189f5d5b4145",
  "supabase/migrations/20260902103000_asset_evidence_intake_execution.sql": "9de3722226dd870b50fcdeb9b38615c4a1aef7768a3f8e27e8939ea509244ca8",
  "supabase/migrations/20260902110000_merge_line_oa_provider_code.sql": "742c1867f8b2f9d442bb374c522692a57e5d01388fe00fbbe3bc7e1ce8ca6865",
  "supabase/migrations/20260904090000_edge_device_credential_and_extraction_job.sql": "416b3b5bd0822e675497262cc34759278bd8d82067561bfd529cee008bac695f",
  "supabase/migrations/20260905120000_line_oa_account.sql": "f8a849f1d015fce37e29a6af925a2d58fcbacd1daebefc95fd41caa9afdb8c0f",
  "supabase/migrations/20260906090000_raw_external_record_artifact_id.sql": "c1fe4f82160e5dce5bcc964cbe04d7a6ca7449cec8bf57e768ea1388550992a3",
  "supabase/migrations/20260906110000_conversation_channel_account.sql": "c90ac551b2320303947991e0506422fd9766fb41dd712e59264e9cba0ea88356",
  "supabase/migrations/20260906120000_record_pre_lineage_tables_and_columns.sql": "b218738af0f70bc6f3e35a34045919c442edf0fd35bb174c7f3fb6c28774479e",
  "supabase/migrations/20260906150000_line_oa_rich_menu.sql": "153a01b9e3b9e5e3f468fa5aea07b18c7edcc6c6da2976e9335919a6b10ea83b",
  "supabase/migrations/20260906160000_server_line_jobs.sql": "e0c0b59ed88a528d83d5b061aade6c5021a59ddda556959575f535957232c5ad",
  "supabase/migrations/20260906180000_line_conversation_job_rls_policy.sql": "2e9c9ac026de24986053db33a3fba4e8c3edcd45276ab50265b3817462445dc2",
  "supabase/migrations/20260906190000_line_oa_rich_menu_job.sql": "19c06136f7ce98bb1f587755bc83343b3597f645714eb933bee2b383fd701755",
  "supabase/migrations/20260906200000_marketing_strategy.sql": "946da0f7fd6adb6a7122859e59aacb8246a4aec2cc9af1eabbe4cf3548e4e144",
  "supabase/migrations/20260906210000_line_oa_liff_app.sql": "b6939fbd18817b3f6548cfbdb122e3910bf963ce82b79f067b32379f2ed72a83",
  "supabase/migrations/20260906220000_marketing_campaigns.sql": "773d96dfcf206a151786c83b25b32fb380861fc1590b43236efc09490a73ecf7",
  "supabase/migrations/20260906230000_inventory_domain.sql": "987d4a02005a1edcbb201a2604d27746772da2d2ccc5936abe59f3200a7f07de",
  "supabase/migrations/20260906233000_inventory_recipe.sql": "da30be1f2aff3ee25b20d97c0f05f0871f4522d50cdc218a971f5d6c0a109ead",
  "supabase/migrations/20260906234000_marketing_content.sql": "a1b35ed34a08e22da79a88ea238340729a6d6259aec10ad571918612fd943d10",
  "supabase/migrations/20260906235000_revoke_service_role_on_public.sql": "e39f2f922d2f487c23967942cb07f2d0bda1721b7228bbb01fd32829ae806142",
  "supabase/migrations/20260906235500_crm_sales_task.sql": "3bc2b39698882a2c048d45d507974e1f197dd62ed8010f34ddff34dcb93502fc",
  "supabase/migrations/20260907000000_commerce_orders_payments.sql": "f692f20f6ba71c512150b2b182ea3d4b74a5e745cddd18f9769e8ed5cbe0ddd4",
  "supabase/migrations/20260907010000_procurement.sql": "d560cd9de0248216871f2c97ac6df91ce8b8f37adf085858b4240732482e63a5",
  "supabase/migrations/20260907090000_marketing_operations.sql": "6ea73acefe98bb2e48fcd09e4c300ad5eee35a05b5bbb25963e70e65ef207243",
  "supabase/migrations/20260907120000_knowledge_evidence_cursor.sql": "23213a84aa8c66450852a56d50a1cd460ffda8ea20c6a44ce5333a33a6e5d3ea",
  "supabase/migrations/20260907130000_revoke_execute_on_public_functions.sql": "35ee23969d1559d28d90238f4bca30c8894309fea948104715924d019af5f1ff",
  "supabase/migrations/20260907140000_inventory_service_nature.sql": "328028269f938cf90555cba8e4e457b105602bedf1c63078c231ecb00475d37f",
  "supabase/migrations/20260907150000_business_capabilities.sql": "757bdd7ff0461a368ae7c526ef4e7d35cfa08bbfbd6c12e1ba3a42bd6ebf256c",
  "supabase/migrations/20260907160000_genesisrag17_tier1.sql": "cf339eb9f8a19be511576f7e448392c2f014d5d812de523c4f672fd1dc1fcdb5",
  "supabase/migrations/20260907233000_execution_trace.sql": "bda1ddc0948eb830da5e8196433dfd961736288ab5eebd5620977c0292bb551c",
  "supabase/migrations/20260908040000_genesisrag17_audit_remediation.sql": "1440670013ddf5ff539af0096688ab1943f23e3db30999979d030d8f2f0d33f4",
  "supabase/migrations/20260908100000_knowledge_admission.sql": "e9e1e742351674deabb2b475e50c96545ff21db100602f05c4b57c3e5cff2117",
  "supabase/migrations/20260910120000_smartgift_scm_wip.sql": "a80da1133ebf9ff521f0c0c6560d927621c03761553c5b843883def20e7c66ed",
  "supabase/migrations/20260911010000_commerce_billing_pos.sql": "512becf9e45c3957d289255bc696f5a7755ab8a02163e6051abda0fa6a0d44d4",
  "supabase/migrations/20260911020000_inventory_stocktake.sql": "d4fdd7d9fd33a5061fb0215ce7be93181f20be492a3053bd9e67f8402ae244d7",
  "supabase/migrations/20260911030000_marketing_broadcast_intents.sql": "25a9f808d0e9d4e0b8e3bac2176f2d9d412083282ebbabec27a34a393e2b3a0b",
  "supabase/migrations/20260911040000_line_worker_memory.sql": "30848716eacd8901d5697731dfc715b84fa477069984e204cb539e0a8155e0ef",
  "supabase/migrations/20260912120000_access_grant_lifecycle.sql": "0365bb9f5600f745f0ec7483712f441b0a6190f1bbdc26b9bed66073e303c0cb",
  "supabase/migrations/20260912130000_org_employment_legal_entity.sql": "3bf7104839cd61f004ca47f1ceb00a7a83fd6d6dacd192c9e57b4c7dad48ddf9",
  "supabase/migrations/20260912140000_access_invite_sod_operator.sql": "df51eb2dcfead1ca772873fb2e9ec4f6bfe723fc7253856591b1f041f334ed20",
  "supabase/migrations/20260912150000_audit_scope_and_evidence.sql": "091b679257aaa6c94953eb6fd4ac71615e6ef5501e222d462321a9a6bc396754",
  "supabase/migrations/20260912160000_p2_mfa_session_assurance.sql": "64172346381d0eff1a58964415189ee1feb7678aaf9144e8c5135811abb656b3",
  "supabase/migrations/20260912170000_p2_webauthn_passkeys.sql": "2da3cfa14934e6fc274dac43ff2c5a25869891abbb444b5610ed0d16f0b98839",
  "supabase/migrations/20260913120000_inventory_sku_governance.sql": "d0f9f68060dbc79c316eb5a328826a639deb339ac191f52be935b6ce8b0984ee",
  "supabase/migrations/20260913200000_inventory_catalog_intake.sql": "59a119d561fe0a32e0015e8b1451002e5963dfbf3d8d1e791ba3d650a21c441e",
  "supabase/migrations/20260913230000_programme_usage_report.sql": "cfebeb8ec9782ee8542800aa15ff8925666bcc1b691dd0d24b1a98cddeed90cb",
  "supabase/migrations/20260914100000_harness_usage_attribution.sql": "cefd40bdec444b817382553debb1d902f507f73329f1eaeeacf533d53891731c",
  "supabase/migrations/20260914120000_usage_detail.sql": "653f322dfeab21799faa81c1660cf1e1584e9099e4ee26dffb95f3df4af17742",
  "supabase/migrations/20260914140000_integration_credential_lifecycle.sql": "4fc69c08465bd0f43b56cccf42f843184bc9c96b6c9a14bcf95d6077854afa4c",
  "supabase/migrations/20260914140100_channel_account_claim.sql": "9c8dd45b4b2ef975f334fe6ea3b68d69f6de6279481fc07ef0e8692b560f6792",
  "supabase/migrations/20260914140200_channel_secret_vault_functions.sql": "a59fadc784e4ba4c892ccfad30494022b3b6b2f795f5c4d0e76ef50e24fbf8de",
  "supabase/migrations/20260914140300_integration_secret_envelope.sql": "4470418b63b95f97c980e35691024835b9db6fb3fbd11547f9da7d69e9d80fc3",
  "supabase/migrations/20260914140400_rate_limit_bucket.sql": "da644b5cd417aca5f02e40439c1dcf8ccf723e1224470269f9d18d67dcf03573",
  "supabase/migrations/20260914150000_crm_message_attachments_events.sql": "244958620919a2fdd4398a9d65709d32f68903de6b5ee23d60fd7d08fff56444",
  "supabase/migrations/20260914150100_line_oa_knowledge_grounding.sql": "1f4c5a6e90349e58e95665fe66fed66caa45f00754fc4baf9528674ba1714225",
  "supabase/migrations/20260914150200_knowledge_candidate.sql": "69afce84dd27ae1a1798469c2eb2af4c1b0f8734085bf7e68f48735277c87691",
  "supabase/migrations/20260914150300_line_oa_webhook_state.sql": "0c4b6b7d3676a6b5592f9a5b24549859db4c5512a923b6ed60ada0baab1bc8cd",
  "supabase/migrations/20260914150400_crm_conversation_retention_and_search.sql": "2ac263c618ebf2e1c648ebfeb81caa14e090a47314d54000af98a673b780b2e1",
  "supabase/migrations/20260914150550_knowledge_candidates_business_toggle.sql": "6c1a9bc8c11f4da400a38d393812f292a950780f6da53f0a0128491d46618ceb",
  "supabase/migrations/20260915000000_credential_vault_provider_kinds.sql": "bcda396f746cb79b2947738bbc096035e4be51d336983aa73a347141aa146a1d",
  "supabase/migrations/20260916090000_crm_conversation_sessions.sql": "1d370a1ba3c23153f0824b9b21fa4734cd68dc766e67ec4fa3c71a3c251df971",
  "supabase/migrations/20260916120000_line_job_session.sql": "759af1fd0db46ef0e0e1fe869d50dc823132e87ed431e2e9c44c16846b0b32ef",
  "supabase/migrations/20260916130000_line_oa_business_hours.sql": "9996f35113f9044cd06f5ac2e0726de6d44b1900b90612604cdebfc9bda71d20",
  "supabase/migrations/20260916150000_crm_chat_evidence_archive.sql": "765ea75192f2ebcf3c50aace90b67c06a841e9fe2dd4550ddaa4120401cd11da",
  "supabase/migrations/20260916160000_crm_customer_legal_hold.sql": "1a82c78555e59624a86f6cd9d86d9d3496278c8c61700af5643c6c747531682f",
  "supabase/migrations/20260916180000_observability_error_and_usage_events.sql": "dcb77a258ed0e2190cdfa1c9ed7020ab9b2b77b531ee578cec9e098d2cfba4ca",
  "supabase/migrations/20260916190000_usage_event_rollup.sql": "a64909781a625dc1dd3c518311b974cb8344642272d14788135d3c0ca250a5e5",
  "supabase/migrations/20260917030000_commerce_pricing_rules.sql": "29074b1a5033a96dd88edb62953d34396134877419fcbf0de75f47adce5c9dbf",
  "supabase/migrations/20260917041000_add_phase_b_feature_authority.sql": "9cdc9dec66a479b55238488e4bc8e14b637bb9ca9af2e7671aa5a382767d60c3",
  "supabase/migrations/20260917153000_knowledge_artifact_storage.sql": "b5c4d3a93cc55744fbfd4f147e979ff80297a333f63901f73282128fa93a51ae",
  "supabase/migrations/20260918120000_knowledge_catalog_storage.sql": "ef83f7d11ae3c51a1b846d9a012965edd1f0ea248d842ea368b6945160a88d1d",
  "supabase/migrations/20260919090000_supplier_cost_sheet.sql": "bc035bc16757739ebf7436e6603d01285557447e18a9198790d24ca52a9511af",
  "supabase/migrations/20260921090000_line_oa_retire_edge_execution.sql": "43d5a123314f5a7c8760725430ec64383e731c02fa2f2269794fb7f93a18c700",
  "supabase/migrations/20260922100000_force_person_rls.sql": "9928c12f636f8afe69b0c514096582930076f2ed34c01cfd78d6685b690076ed",
  "supabase/migrations/20260922120000_pm_execution_trace_replay.sql": "7ae1116ed7fe966c5bdfd2dab9c5b74fadc4ff4fa1d7fb1ad9e69133de5337ec",
  "supabase/migrations/20260922130000_business_key_results.sql": "46c20760a6f6a12ab8c5c791427034cdb08c5bcad851c32346992092b93cabb4",
  "supabase/migrations/20260923010000_pm_approval_gateway_admission.sql": "a2edb856eb1a281cfad9ba37fa813c438716c4a23e72d02f7459a1b42d2e7d3c",
  "supabase/migrations/20260923020000_pm_trace_and_iam_rls_hardening.sql": "a9efd89d08f624da16f3785ae6bcc40274ec261c6d5d448eabd6ce3339506fcf",
  "supabase/migrations/20260923030000_line_oa_worker_checkpoint.sql": "24cdfdd82c2c585083171b84677fb68013bce95a907190184d73a672958e9c00",
  "supabase/migrations/20260925120000_line_conversation_runtime_owner.sql": "3c369abddf55cf795b6c211ba2b0d429da0db8a0983b57bebda4947d9c59ce3e",
  "supabase/migrations/20260926010000_notion_oauth_webhook.sql": "2e51c254af50cc043ebc87091ddbd3fd1200837a4eedfd0ebcc2c413f9d517f0",
  "supabase/migrations/20260927090000_message_author_channel_identity.sql": "366fc34158af9ee6a4b2707f3f9c1a054db629440d23bd7caacb1ebfcaf9da5b",
  "supabase/migrations/20260927090100_message_author_channel_identity_index.sql": "b268ee21ac95d0f72f0163754a52954037c507a2e6d28af2f6ceb0e4fd3b2741",
  "supabase/migrations/20260927090200_message_author_channel_identity_backfill.sql": "c97b304e2dd0a99c05d45e3b74d7a639eeeafd8e297d0c9d0f3e8baa89181cb0",
  "supabase/migrations/20260927120000_line_grounding_shadow_compare.sql": "eeb598f28ce9eb9f1d7b991f57899d10c38f7a98c5eaf85b6e3ab8010cc1ab34",
  "supabase/migrations/20260927230000_crm_retention_consent_and_hold_key.sql": "2780e39d3325c6781ef07015a3d4ac0661efdac1a628564771dd3b5be8590fad",
  "supabase/migrations/20260928090000_agent_trace_event_erasure_scan_index.sql": "605a6435ad5575e5dba75bcbaa03016890d9dafc915769747a60e0e91e6cd902",
  "supabase/migrations/20261004090000_line_memory_policy_and_episodic_snapshot.sql": "9e6b5dcc6aca726c94f4e4b0811f71c0c85cb04c90299782571aad32f5b28c59",
  "supabase/migrations/20261004130000_line_memory_project_scope.sql": "510000d3a225b12739417a7949b62b0aa9074d28d7e01a690acfd078c8d102ca",
  "supabase/migrations/20261004143000_line_memory_projection_receipts.sql": "4e9d4b7b338d8ce41ba5f12d50fea9a5d7fd41d7b3f905b48b8305c196056d85",
  "supabase/migrations/20261005124416_marketing_external_report.sql": "0f3f2b42852eb8c7f313a1b2457cc8f36a8b01896947539c4ed591f4e20a2a0c",
  "supabase/migrations/20261012120000_business_kpis.sql": "332e6b42f20bbb134bf8645890f0170240d4ab7b8f706a7680df9366eb9e8be5",
  "supabase/migrations/20261012162000_business_wig_execution.sql": "b0c57b3c28a80655cc823fccf83524e1078a882731c465c0bd7fb2bd07a1d6b7",
  "supabase/migrations/20261015003000_business_agent_config.sql": "4795f721131024ff9c3e8e95ce971c77531817a19b2583c1aaa2276b8990759b",
  "supabase/migrations/20261015010000_standard_business_provisioning.sql": "09617043cb18f365216b2fcd372d118c8e469c3ac127d39fcdee1231a3328cce",
  "supabase/migrations/20261016000000_agent_approval_gateway.sql": "00c97495571178920a419574407c9fb8bf3c83e7e578baad1873548e01248b74",
  "supabase/migrations/20261018140000_agent_approval_notifications.sql": "99315c7a0a94534907729faf908f20d2a873b7a25365fad071cab0d589709b81",
  "supabase/migrations/20261023090000_scope_crud_metadata.sql": "29b08f93ac801e8eae0da520ac0c39ac769f39a7e2caf63f164ab9953d15f613",
  "supabase/migrations/20261023130000_line_product_facts.sql": "80cca13bd55516c4e0cf5ced3d14d033c12f8eb66c41db3dbc10dbd869cbf92d",
  "supabase/migrations/20261024010000_dependency_handoff.sql": "7ebd65cccbb049f92a8e0c246b7866888f65e39958b855ae43ffbb704e965d19",
  "supabase/migrations/20261024120000_line_product_disclosure_policy.sql": "684408a8247a5e111baa4f0d6d523d8f6cfac5fc4dac99a65f292d90e055ce01",
  "supabase/migrations/20261029140000_agent_mission_intake.sql": "a15fb25faca7b64328620fca145c0f3db5cde24cd8bf9e51f60cdf411d3ea95d",
  "supabase/migrations/20261030140000_managed_blob_recovery_custody.sql": "ce01d866f7cd5c4e61581b4db005d7042dbbebff99ef516660c8e3640a71e909"
})
