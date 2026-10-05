-- @req FR-281, FR-282, FR-283; @spec SDD-112
-- Additive PostgreSQL mirror; structural QA only, receiver runtime disabled.
-- NOT APPLIED to live databases. Explicit migration/release authorization required.
BEGIN;
-- These two native-write guards must see retained custody rows through forced RLS.
-- Require an explicit trusted migration owner, never a runtime/browser principal.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'MARKETING_REPORT_MIRROR_TRUSTED_OWNER_REQUIRED';
  END IF;
END $$;
-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketingReportPolicy" (
    "businessId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ingestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingReportPolicy_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketingReportBinding" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'zuri-go',
    "sourceDeploymentId" TEXT NOT NULL,
    "sourceBusinessId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'marketing.report.ingest',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingReportBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketingExternalReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "initiativeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sourceDeploymentId" TEXT NOT NULL,
    "sourceBusinessId" TEXT NOT NULL,
    "sourceCampaignId" TEXT NOT NULL,
    "sourceReportId" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "reportRevision" INTEGER NOT NULL,
    "supersedesReportId" TEXT,
    "canonicalEnvelope" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "receiverReceiptId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED_REPORTED_EVIDENCE',
    "retentionPolicyVersion" INTEGER NOT NULL DEFAULT 1,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "auditEventId" TEXT NOT NULL,

    CONSTRAINT "MarketingExternalReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingReportBinding_keyHash_key" ON "MarketingReportBinding"("keyHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingReportBinding_businessId_status_idx" ON "MarketingReportBinding"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingExternalReport_receiverReceiptId_key" ON "MarketingExternalReport"("receiverReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingExternalReport_auditEventId_key" ON "MarketingExternalReport"("auditEventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingExternalReport_tenantId_businessId_initiativeId_ac_idx" ON "MarketingExternalReport"("tenantId", "businessId", "initiativeId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingExternalReport_bindingId_sourceReportId_key" ON "MarketingExternalReport"("bindingId", "sourceReportId");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingReportPolicy"'::regclass AND conname='MarketingReportPolicy_businessId_fkey') THEN
ALTER TABLE "MarketingReportPolicy" ADD CONSTRAINT "MarketingReportPolicy_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingReportPolicy"'::regclass AND conname='MarketingReportPolicy_tenantId_fkey') THEN
ALTER TABLE "MarketingReportPolicy" ADD CONSTRAINT "MarketingReportPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingReportBinding"'::regclass AND conname='MarketingReportBinding_tenantId_fkey') THEN
ALTER TABLE "MarketingReportBinding" ADD CONSTRAINT "MarketingReportBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingReportBinding"'::regclass AND conname='MarketingReportBinding_businessId_fkey') THEN
ALTER TABLE "MarketingReportBinding" ADD CONSTRAINT "MarketingReportBinding_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "MarketingReportPolicy"("businessId") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingExternalReport"'::regclass AND conname='MarketingExternalReport_tenantId_fkey') THEN
ALTER TABLE "MarketingExternalReport" ADD CONSTRAINT "MarketingExternalReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingExternalReport"'::regclass AND conname='MarketingExternalReport_businessId_fkey') THEN
ALTER TABLE "MarketingExternalReport" ADD CONSTRAINT "MarketingExternalReport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingExternalReport"'::regclass AND conname='MarketingExternalReport_bindingId_fkey') THEN
ALTER TABLE "MarketingExternalReport" ADD CONSTRAINT "MarketingExternalReport_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "MarketingReportBinding"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingExternalReport"'::regclass AND conname='MarketingExternalReport_initiativeId_fkey') THEN
ALTER TABLE "MarketingExternalReport" ADD CONSTRAINT "MarketingExternalReport_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "MarketingInitiative"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingExternalReport"'::regclass AND conname='MarketingExternalReport_planId_fkey') THEN
ALTER TABLE "MarketingExternalReport" ADD CONSTRAINT "MarketingExternalReport_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."MarketingExternalReport"'::regclass AND conname='MarketingExternalReport_auditEventId_fkey') THEN
ALTER TABLE "MarketingExternalReport" ADD CONSTRAINT "MarketingExternalReport_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
END IF; END $$;

-- @req FR-281/282/283 — portable equivalents of the SQLite custody guards.
-- Generated model DDL above; reviewed guards below. PostgreSQL receiver service
-- qualification is not implied: the application receiver still refuses PG URLs.
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

-- PostgreSQL receiver is disabled. No Data API or runtime role gets access.
ALTER TABLE "MarketingReportPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingReportPolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MarketingReportBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingReportBinding" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MarketingExternalReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingExternalReport" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MarketingReportPolicy", "MarketingReportBinding", "MarketingExternalReport" FROM PUBLIC;
DO $$
DECLARE principal text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'zuri_app_runtime', 'zuri_web_login'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal) THEN
      EXECUTE format('REVOKE ALL ON TABLE "MarketingReportPolicy", "MarketingReportBinding", "MarketingExternalReport" FROM %I', principal);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION marketing_report_audit_guard(), marketing_report_native_scope_guard() FROM PUBLIC;
DO $$
DECLARE principal text;
BEGIN
  FOREACH principal IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'zuri_app_runtime', 'zuri_web_login'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = principal) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION marketing_report_audit_guard(), marketing_report_native_scope_guard() FROM %I', principal);
    END IF;
  END LOOP;
END $$;
COMMIT;