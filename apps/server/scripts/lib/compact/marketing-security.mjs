// @req FR-281, FR-282, FR-283 — fresh Compact custody guards, not issued migration execution.
// @spec ADR-115, SDD-112
// @tested tests/postgres/marketing-report-native.test.js
// Copied verbatim guard declarations from the issued structural mirror. The
// mirror stays disabled; fresh runtime ACLs are selected separately in security.mjs.
export const COMPACT_MARKETING_SECURITY_SQL = String.raw`
DO $compact_marketing_owner$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
  RAISE EXCEPTION 'COMPACT_MARKETING_TRUSTED_OWNER_REQUIRED';
 END IF;
END $compact_marketing_owner$;
CREATE OR REPLACE FUNCTION marketing_report_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MARKETING_REPORT_POLICY_RETAINED'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW."version"<>1 OR NOT EXISTS(SELECT 1 FROM "Business" b WHERE b.id=NEW."businessId" AND b."tenantId"=NEW."tenantId")
      THEN RAISE EXCEPTION 'MARKETING_REPORT_POLICY_INVALID'; END IF;
  ELSE
    IF NEW."businessId" IS DISTINCT FROM OLD."businessId" OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW.version<>OLD.version+1 OR NEW."ingestEnabled"=OLD."ingestEnabled"
      THEN RAISE EXCEPTION 'MARKETING_REPORT_POLICY_INVALID'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public."MarketingReportPolicy"'::regclass AND tgname='marketing_report_policy_guard') THEN
CREATE TRIGGER marketing_report_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON "MarketingReportPolicy" FOR EACH ROW EXECUTE FUNCTION marketing_report_policy_guard();
END IF; END $$;

CREATE OR REPLACE FUNCTION marketing_report_binding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MARKETING_REPORT_BINDING_RETAINED'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      OR NEW."sourceBusinessId" !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      OR NEW."keyHash" !~ '^[a-f0-9]{64}$' OR NEW."sourceSystem"<>'zuri-go' OR NEW.permission<>'marketing.report.ingest'
      OR NEW.status<>'ACTIVE' OR NEW."revokedAt" IS NOT NULL OR NEW.version<>1
      OR NEW."sourceDeploymentId" !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$'
      OR NOT EXISTS(SELECT 1 FROM "MarketingReportPolicy" p JOIN "Business" b ON b.id=p."businessId"
        WHERE p."businessId"=NEW."businessId" AND p."tenantId"=NEW."tenantId" AND b."tenantId"=NEW."tenantId")
      THEN RAISE EXCEPTION 'MARKETING_REPORT_BINDING_INVALID'; END IF;
  ELSIF NEW IS DISTINCT FROM OLD THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."keyHash" IS DISTINCT FROM OLD."keyHash" OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
      OR NEW."businessId" IS DISTINCT FROM OLD."businessId" OR NEW."sourceSystem" IS DISTINCT FROM OLD."sourceSystem"
      OR NEW."sourceDeploymentId" IS DISTINCT FROM OLD."sourceDeploymentId" OR NEW."sourceBusinessId" IS DISTINCT FROM OLD."sourceBusinessId"
      OR NEW.permission IS DISTINCT FROM OLD.permission OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR OLD.status<>'ACTIVE' OR OLD."revokedAt" IS NOT NULL OR NEW.status<>'REVOKED' OR NEW."revokedAt" IS NULL OR NEW.version<>OLD.version+1
      THEN RAISE EXCEPTION 'MARKETING_REPORT_BINDING_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public."MarketingReportBinding"'::regclass AND tgname='marketing_report_binding_guard') THEN
CREATE TRIGGER marketing_report_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON "MarketingReportBinding" FOR EACH ROW EXECUTE FUNCTION marketing_report_binding_guard();
END IF; END $$;

CREATE OR REPLACE FUNCTION marketing_external_report_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE wire jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'MARKETING_REPORT_EVIDENCE_IMMUTABLE'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[NEW.id,NEW."receiverReceiptId",NEW."sourceReportId",NEW."sourceCampaignId",NEW."auditEventId"]) AS x(value)
    WHERE value !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
    OR NEW."reportRevision"<>1 OR NEW."supersedesReportId" IS NOT NULL OR NEW."contractVersion"<>'zuri-marketing-report/0.1'
    OR NEW.status<>'ACCEPTED_REPORTED_EVIDENCE' OR NEW."retentionPolicyVersion"<>1 OR NOT isfinite(NEW."acceptedAt")
    OR NOT isfinite(NEW."retainUntil") OR NEW."retainUntil"<NEW."acceptedAt"+interval '90 days'
    OR NEW."payloadHash" !~ '^[a-f0-9]{64}$' OR octet_length(NEW."canonicalEnvelope")>262144
    THEN RAISE EXCEPTION 'MARKETING_REPORT_EVIDENCE_INVALID'; END IF;
  wire:=NEW."canonicalEnvelope"::jsonb;
  IF wire->>'contractVersion' IS DISTINCT FROM NEW."contractVersion" OR wire->>'reportId' IS DISTINCT FROM NEW."sourceReportId"
    OR wire->'reportRevision' IS DISTINCT FROM '1'::jsonb OR wire->'supersedesReportId' IS DISTINCT FROM 'null'::jsonb
    OR wire->>'payloadHash' IS DISTINCT FROM NEW."payloadHash" OR wire#>>'{source,system}' IS DISTINCT FROM 'zuri-go'
    OR wire#>>'{source,deploymentId}' IS DISTINCT FROM NEW."sourceDeploymentId" OR wire#>>'{source,sourceBusinessId}' IS DISTINCT FROM NEW."sourceBusinessId"
    OR wire#>>'{target,bindingId}' IS DISTINCT FROM NEW."bindingId" OR wire#>>'{target,initiativeId}' IS DISTINCT FROM NEW."initiativeId"
    OR wire#>>'{campaign,sourceCampaignId}' IS DISTINCT FROM NEW."sourceCampaignId"
    OR jsonb_typeof(wire->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(wire->'window') IS DISTINCT FROM 'object'
    OR jsonb_typeof(wire->'sourceRevision') IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'MARKETING_REPORT_WIRE_PARITY'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "MarketingReportBinding" k JOIN "MarketingReportPolicy" p ON p."businessId"=k."businessId"
    JOIN "Business" b ON b.id=k."businessId" JOIN "MarketingInitiative" i ON i.id=NEW."initiativeId" JOIN "MarketingPlan" m ON m.id=i."planId"
    WHERE k.id=NEW."bindingId" AND k."tenantId"=NEW."tenantId" AND k."businessId"=NEW."businessId"
      AND k."sourceDeploymentId"=NEW."sourceDeploymentId" AND k."sourceBusinessId"=NEW."sourceBusinessId"
      AND k."sourceSystem"='zuri-go' AND k.permission='marketing.report.ingest' AND k.status='ACTIVE' AND k."revokedAt" IS NULL
      AND p."ingestEnabled" AND p."tenantId"=NEW."tenantId" AND b."tenantId"=NEW."tenantId" AND b.status='ACTIVE'
      AND i."tenantId"=NEW."tenantId" AND i."businessId"=NEW."businessId" AND i.status='OPEN' AND i."deletedAt" IS NULL
      AND m.id=NEW."planId" AND m."tenantId"=NEW."tenantId" AND m."businessId"=NEW."businessId" AND m."deletedAt" IS NULL)
    THEN RAISE EXCEPTION 'MARKETING_REPORT_SCOPE_INVALID'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "AuditEvent" a WHERE a.id=NEW."auditEventId" AND a."tenantId"=NEW."tenantId" AND a."businessId"=NEW."businessId"
    AND a."entityType"='MARKETING_EXTERNAL_REPORT' AND a."entityId"=NEW.id AND a.action='REPORTED_EVIDENCE_ACCEPTED'
    AND a."actorType"='MARKETING_REPORT_BINDING' AND a."actorId"=NEW."bindingId")
    THEN RAISE EXCEPTION 'MARKETING_REPORT_AUDIT_INVALID'; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public."MarketingExternalReport"'::regclass AND tgname='marketing_external_report_guard') THEN
CREATE TRIGGER marketing_external_report_guard BEFORE INSERT OR UPDATE OR DELETE ON "MarketingExternalReport" FOR EACH ROW EXECUTE FUNCTION marketing_external_report_guard();
END IF; END $$;

CREATE OR REPLACE FUNCTION marketing_report_audit_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM "MarketingExternalReport" r WHERE r."auditEventId"=OLD.id) THEN RAISE EXCEPTION 'MARKETING_REPORT_AUDIT_IMMUTABLE'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public."AuditEvent"'::regclass AND tgname='marketing_report_audit_guard') THEN
CREATE TRIGGER marketing_report_audit_guard BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION marketing_report_audit_guard();
END IF; END $$;

CREATE OR REPLACE FUNCTION marketing_report_native_scope_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='Business' THEN
    IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" AND EXISTS(SELECT 1 FROM "MarketingReportPolicy" p WHERE p."businessId"=OLD.id)
      THEN RAISE EXCEPTION 'MARKETING_REPORT_NATIVE_SCOPE_IMMUTABLE'; END IF;
  ELSIF TG_TABLE_NAME='MarketingInitiative' THEN
    IF (NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."businessId" IS DISTINCT FROM OLD."businessId" OR NEW."planId" IS DISTINCT FROM OLD."planId")
      AND EXISTS(SELECT 1 FROM "MarketingExternalReport" r WHERE r."initiativeId"=OLD.id) THEN RAISE EXCEPTION 'MARKETING_REPORT_NATIVE_SCOPE_IMMUTABLE'; END IF;
  ELSE
    IF (NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."businessId" IS DISTINCT FROM OLD."businessId")
      AND EXISTS(SELECT 1 FROM "MarketingExternalReport" r WHERE r."planId"=OLD.id) THEN RAISE EXCEPTION 'MARKETING_REPORT_NATIVE_SCOPE_IMMUTABLE'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public."Business"'::regclass AND tgname='marketing_report_business_scope_guard') THEN
CREATE TRIGGER marketing_report_business_scope_guard BEFORE UPDATE ON "Business" FOR EACH ROW EXECUTE FUNCTION marketing_report_native_scope_guard();
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public."MarketingInitiative"'::regclass AND tgname='marketing_report_initiative_scope_guard') THEN
CREATE TRIGGER marketing_report_initiative_scope_guard BEFORE UPDATE ON "MarketingInitiative" FOR EACH ROW EXECUTE FUNCTION marketing_report_native_scope_guard();
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public."MarketingPlan"'::regclass AND tgname='marketing_report_plan_scope_guard') THEN
CREATE TRIGGER marketing_report_plan_scope_guard BEFORE UPDATE ON "MarketingPlan" FOR EACH ROW EXECUTE FUNCTION marketing_report_native_scope_guard();
END IF; END $$;

-- The issued mirror remains disabled. This fresh Compact TEST snapshot's
-- server-only report privileges are bounded separately in security.mjs.

REVOKE ALL ON FUNCTION marketing_report_policy_guard(),marketing_report_binding_guard(),marketing_external_report_guard(),marketing_report_audit_guard(),marketing_report_native_scope_guard() FROM PUBLIC,zuri_app_runtime,zuri_web_login;
`
