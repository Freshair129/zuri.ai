-- @req FR-185
-- @spec FR-157, FR-159, FR-160, FR-103, SEC-001, SEC-003
BEGIN;

CREATE TABLE "MarketingBroadcastIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "MarketingBroadcastIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingBroadcastIntentVersion" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingBroadcastIntentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingBroadcastIntent_businessId_idempotencyKey_key" ON "MarketingBroadcastIntent"("businessId", "idempotencyKey");
CREATE UNIQUE INDEX "MarketingBroadcastIntent_businessId_code_key" ON "MarketingBroadcastIntent"("businessId", "code");
CREATE INDEX "MarketingBroadcastIntent_tenantId_businessId_status_idx" ON "MarketingBroadcastIntent"("tenantId", "businessId", "status");
CREATE UNIQUE INDEX "MarketingBroadcastIntentVersion_intentId_revision_key" ON "MarketingBroadcastIntentVersion"("intentId", "revision");

ALTER TABLE "MarketingBroadcastIntent"
  ADD CONSTRAINT "MarketingBroadcastIntent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingBroadcastIntent"
  ADD CONSTRAINT "MarketingBroadcastIntent_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingBroadcastIntentVersion"
  ADD CONSTRAINT "MarketingBroadcastIntentVersion_intentId_fkey"
  FOREIGN KEY ("intentId") REFERENCES "MarketingBroadcastIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketingBroadcastIntent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingBroadcastIntent" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingBroadcastIntent" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MarketingBroadcastIntent" TO zuri_app_runtime, zuri_web_login;
REVOKE ALL ON TABLE "MarketingBroadcastIntent" FROM public, anon, authenticated, service_role;

ALTER TABLE "MarketingBroadcastIntentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingBroadcastIntentVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingBroadcastIntentVersion" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MarketingBroadcastIntentVersion" TO zuri_app_runtime, zuri_web_login;
REVOKE ALL ON TABLE "MarketingBroadcastIntentVersion" FROM public, anon, authenticated, service_role;

COMMIT;
