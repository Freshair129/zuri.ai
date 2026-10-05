-- CreateTable
CREATE TABLE "MarketingReportPolicy" (
    "businessId" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "ingestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketingReportPolicy_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "MarketingReportPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "MarketingReportBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'zuri-go',
    "sourceDeploymentId" TEXT NOT NULL,
    "sourceBusinessId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'marketing.report.ingest',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "MarketingReportBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "MarketingReportBinding_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "MarketingReportPolicy" ("businessId") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateTable
CREATE TABLE "MarketingExternalReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "acceptedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED_REPORTED_EVIDENCE',
    "retentionPolicyVersion" INTEGER NOT NULL DEFAULT 1,
    "retainUntil" DATETIME NOT NULL,
    "auditEventId" TEXT NOT NULL,
    CONSTRAINT "MarketingExternalReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "MarketingExternalReport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "MarketingExternalReport_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "MarketingReportBinding" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "MarketingExternalReport_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "MarketingInitiative" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "MarketingExternalReport_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "MarketingExternalReport_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent" ("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingReportBinding_keyHash_key" ON "MarketingReportBinding"("keyHash");

-- CreateIndex
CREATE INDEX "MarketingReportBinding_businessId_status_idx" ON "MarketingReportBinding"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingExternalReport_receiverReceiptId_key" ON "MarketingExternalReport"("receiverReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingExternalReport_auditEventId_key" ON "MarketingExternalReport"("auditEventId");

-- CreateIndex
CREATE INDEX "MarketingExternalReport_tenantId_businessId_initiativeId_acceptedAt_idx" ON "MarketingExternalReport"("tenantId", "businessId", "initiativeId", "acceptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingExternalReport_bindingId_sourceReportId_key" ON "MarketingExternalReport"("bindingId", "sourceReportId");

-- @req FR-281/282/283: current scope, append-only evidence and linked audit.
-- SQLite is the qualified receiver engine. SHA-256 and the full wire whitelist
-- are verified by the application; no undocumented SQLite extension is assumed.
CREATE TRIGGER "marketing_report_policy_insert" BEFORE INSERT ON "MarketingReportPolicy"
BEGIN
  SELECT CASE WHEN NEW."version" <> 1 OR NEW."ingestEnabled" NOT IN (0,1)
    OR NOT EXISTS (SELECT 1 FROM "Business" b WHERE b."id"=NEW."businessId" AND b."tenantId"=NEW."tenantId")
    THEN RAISE(ABORT,'MARKETING_REPORT_POLICY_INVALID') END;
END;
CREATE TRIGGER "marketing_report_policy_update" BEFORE UPDATE ON "MarketingReportPolicy"
BEGIN
  SELECT CASE WHEN NEW."businessId" IS NOT OLD."businessId" OR NEW."tenantId" IS NOT OLD."tenantId"
    OR NEW."createdAt" IS NOT OLD."createdAt" OR NEW."version" <> OLD."version"+1
    OR NEW."ingestEnabled" NOT IN (0,1) OR NEW."ingestEnabled"=OLD."ingestEnabled"
    THEN RAISE(ABORT,'MARKETING_REPORT_POLICY_INVALID') END;
END;
CREATE TRIGGER "marketing_report_policy_delete" BEFORE DELETE ON "MarketingReportPolicy"
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_POLICY_RETAINED'); END;

CREATE TRIGGER "marketing_report_binding_insert" BEFORE INSERT ON "MarketingReportBinding"
BEGIN
  SELECT CASE WHEN length(NEW."keyHash")<>64 OR NEW."keyHash" GLOB '*[^a-f0-9]*'
    OR NEW."sourceSystem"<>'zuri-go' OR NEW."permission"<>'marketing.report.ingest'
    OR NEW."status"<>'ACTIVE' OR NEW."revokedAt" IS NOT NULL OR NEW."version"<>1
    OR length(NEW."sourceDeploymentId") NOT BETWEEN 1 AND 160
    OR NEW."sourceDeploymentId" GLOB '*[^A-Za-z0-9_-]*' OR substr(NEW."sourceDeploymentId",1,1) GLOB '[^A-Za-z0-9]'
    OR length(NEW."id")<>36 OR length(replace(NEW."id",'-',''))<>32 OR replace(NEW."id",'-','') GLOB '*[^a-f0-9]*'
    OR substr(NEW."id",9,1)<>'-' OR substr(NEW."id",14,1)<>'-' OR substr(NEW."id",19,1)<>'-' OR substr(NEW."id",24,1)<>'-'
    OR length(NEW."sourceBusinessId")<>36 OR length(replace(NEW."sourceBusinessId",'-',''))<>32 OR replace(NEW."sourceBusinessId",'-','') GLOB '*[^a-f0-9]*'
    OR substr(NEW."sourceBusinessId",9,1)<>'-' OR substr(NEW."sourceBusinessId",14,1)<>'-' OR substr(NEW."sourceBusinessId",19,1)<>'-' OR substr(NEW."sourceBusinessId",24,1)<>'-'
    OR NOT EXISTS (SELECT 1 FROM "MarketingReportPolicy" p JOIN "Business" b ON b."id"=p."businessId"
      WHERE p."businessId"=NEW."businessId" AND p."tenantId"=NEW."tenantId" AND b."tenantId"=NEW."tenantId")
    THEN RAISE(ABORT,'MARKETING_REPORT_BINDING_INVALID') END;
END;
CREATE TRIGGER "marketing_report_binding_update" BEFORE UPDATE ON "MarketingReportBinding"
BEGIN
  SELECT CASE WHEN NEW."id" IS NOT OLD."id" OR NEW."keyHash" IS NOT OLD."keyHash" OR NEW."tenantId" IS NOT OLD."tenantId"
    OR NEW."businessId" IS NOT OLD."businessId" OR NEW."sourceSystem" IS NOT OLD."sourceSystem"
    OR NEW."sourceDeploymentId" IS NOT OLD."sourceDeploymentId" OR NEW."sourceBusinessId" IS NOT OLD."sourceBusinessId"
    OR NEW."permission" IS NOT OLD."permission" OR NEW."createdAt" IS NOT OLD."createdAt"
    OR NOT ((NEW."status" IS OLD."status" AND NEW."version" IS OLD."version" AND NEW."revokedAt" IS OLD."revokedAt")
      OR (OLD."status"='ACTIVE' AND OLD."revokedAt" IS NULL AND NEW."status"='REVOKED' AND NEW."revokedAt" IS NOT NULL AND NEW."version"=OLD."version"+1))
    THEN RAISE(ABORT,'MARKETING_REPORT_BINDING_IMMUTABLE') END;
END;
CREATE TRIGGER "marketing_report_binding_delete" BEFORE DELETE ON "MarketingReportBinding"
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_BINDING_RETAINED'); END;

CREATE TRIGGER "marketing_external_report_insert" BEFORE INSERT ON "MarketingExternalReport"
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(json_array(NEW."id",NEW."receiverReceiptId",NEW."sourceReportId",NEW."sourceCampaignId",NEW."auditEventId")) u
    WHERE length(u.value)<>36 OR length(replace(u.value,'-',''))<>32 OR replace(u.value,'-','') GLOB '*[^a-f0-9]*'
      OR substr(u.value,9,1)<>'-' OR substr(u.value,14,1)<>'-' OR substr(u.value,19,1)<>'-' OR substr(u.value,24,1)<>'-')
    THEN RAISE(ABORT,'MARKETING_REPORT_ID_INVALID') END;
  SELECT CASE WHEN NEW."reportRevision"<>1 OR NEW."supersedesReportId" IS NOT NULL
    OR NEW."contractVersion"<>'zuri-marketing-report/0.1' OR NEW."status"<>'ACCEPTED_REPORTED_EVIDENCE'
    OR NEW."retentionPolicyVersion"<>1 OR typeof(NEW."acceptedAt")<>'integer' OR typeof(NEW."retainUntil")<>'integer'
    OR NEW."retainUntil" < NEW."acceptedAt"+7776000000
    OR length(NEW."payloadHash")<>64 OR NEW."payloadHash" GLOB '*[^a-f0-9]*'
    OR length(CAST(NEW."canonicalEnvelope" AS BLOB))>262144 OR NOT json_valid(NEW."canonicalEnvelope")
    THEN RAISE(ABORT,'MARKETING_REPORT_EVIDENCE_INVALID') END;
  SELECT CASE WHEN json_type(NEW."canonicalEnvelope",'$.reportRevision') IS NOT 'integer'
    OR json_type(NEW."canonicalEnvelope",'$.supersedesReportId') IS NOT 'null'
    OR json_extract(NEW."canonicalEnvelope",'$.contractVersion') IS NOT NEW."contractVersion"
    OR json_extract(NEW."canonicalEnvelope",'$.reportId') IS NOT NEW."sourceReportId"
    OR json_extract(NEW."canonicalEnvelope",'$.reportRevision') IS NOT NEW."reportRevision"
    OR json_extract(NEW."canonicalEnvelope",'$.payloadHash') IS NOT NEW."payloadHash"
    OR json_extract(NEW."canonicalEnvelope",'$.source.system') IS NOT 'zuri-go'
    OR json_extract(NEW."canonicalEnvelope",'$.source.deploymentId') IS NOT NEW."sourceDeploymentId"
    OR json_extract(NEW."canonicalEnvelope",'$.source.sourceBusinessId') IS NOT NEW."sourceBusinessId"
    OR json_extract(NEW."canonicalEnvelope",'$.target.bindingId') IS NOT NEW."bindingId"
    OR json_extract(NEW."canonicalEnvelope",'$.target.initiativeId') IS NOT NEW."initiativeId"
    OR json_extract(NEW."canonicalEnvelope",'$.campaign.sourceCampaignId') IS NOT NEW."sourceCampaignId"
    OR json_type(NEW."canonicalEnvelope",'$.payload') IS NOT 'object'
    OR json_type(NEW."canonicalEnvelope",'$.sourceRevision') IS NOT 'object'
    OR json_type(NEW."canonicalEnvelope",'$.window') IS NOT 'object'
    THEN RAISE(ABORT,'MARKETING_REPORT_WIRE_PARITY') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM "MarketingReportBinding" k
    JOIN "MarketingReportPolicy" p ON p."businessId"=k."businessId"
    JOIN "Business" b ON b."id"=k."businessId"
    JOIN "MarketingInitiative" i ON i."id"=NEW."initiativeId"
    JOIN "MarketingPlan" m ON m."id"=i."planId"
    WHERE k."id"=NEW."bindingId" AND k."tenantId"=NEW."tenantId" AND k."businessId"=NEW."businessId"
      AND k."sourceDeploymentId"=NEW."sourceDeploymentId" AND k."sourceBusinessId"=NEW."sourceBusinessId"
      AND k."sourceSystem"='zuri-go' AND k."permission"='marketing.report.ingest' AND k."status"='ACTIVE' AND k."revokedAt" IS NULL
      AND p."ingestEnabled"=1 AND p."tenantId"=NEW."tenantId" AND b."tenantId"=NEW."tenantId" AND b."status"='ACTIVE'
      AND i."tenantId"=NEW."tenantId" AND i."businessId"=NEW."businessId" AND i."status"='OPEN' AND i."deletedAt" IS NULL
      AND m."id"=NEW."planId" AND m."tenantId"=NEW."tenantId" AND m."businessId"=NEW."businessId" AND m."deletedAt" IS NULL)
    THEN RAISE(ABORT,'MARKETING_REPORT_SCOPE_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "AuditEvent" a WHERE a."id"=NEW."auditEventId"
    AND a."tenantId"=NEW."tenantId" AND a."businessId"=NEW."businessId" AND a."entityType"='MARKETING_EXTERNAL_REPORT'
    AND a."entityId"=NEW."id" AND a."action"='REPORTED_EVIDENCE_ACCEPTED' AND a."actorType"='MARKETING_REPORT_BINDING'
    AND a."actorId"=NEW."bindingId") THEN RAISE(ABORT,'MARKETING_REPORT_AUDIT_INVALID') END;
END;
CREATE TRIGGER "marketing_external_report_update" BEFORE UPDATE ON "MarketingExternalReport"
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER "marketing_external_report_delete" BEFORE DELETE ON "MarketingExternalReport"
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_EVIDENCE_RETAINED'); END;
CREATE TRIGGER "marketing_external_report_audit_update" BEFORE UPDATE ON "AuditEvent"
WHEN EXISTS (SELECT 1 FROM "MarketingExternalReport" r WHERE r."auditEventId"=OLD."id")
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER "marketing_external_report_audit_delete" BEFORE DELETE ON "AuditEvent"
WHEN EXISTS (SELECT 1 FROM "MarketingExternalReport" r WHERE r."auditEventId"=OLD."id")
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_AUDIT_RETAINED'); END;
CREATE TRIGGER "marketing_report_business_scope_update" BEFORE UPDATE ON "Business"
WHEN NEW."tenantId" IS NOT OLD."tenantId" AND EXISTS (SELECT 1 FROM "MarketingReportPolicy" p WHERE p."businessId"=OLD."id")
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_NATIVE_SCOPE_IMMUTABLE'); END;
CREATE TRIGGER "marketing_report_initiative_scope_update" BEFORE UPDATE ON "MarketingInitiative"
WHEN (NEW."tenantId" IS NOT OLD."tenantId" OR NEW."businessId" IS NOT OLD."businessId" OR NEW."planId" IS NOT OLD."planId")
  AND EXISTS (SELECT 1 FROM "MarketingExternalReport" r WHERE r."initiativeId"=OLD."id")
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_NATIVE_SCOPE_IMMUTABLE'); END;
CREATE TRIGGER "marketing_report_plan_scope_update" BEFORE UPDATE ON "MarketingPlan"
WHEN (NEW."tenantId" IS NOT OLD."tenantId" OR NEW."businessId" IS NOT OLD."businessId")
  AND EXISTS (SELECT 1 FROM "MarketingExternalReport" r WHERE r."planId"=OLD."id")
BEGIN SELECT RAISE(ABORT,'MARKETING_REPORT_NATIVE_SCOPE_IMMUTABLE'); END;
