-- @req FR-185
-- @spec FR-157, FR-159, FR-160, FR-103, SEC-001, SEC-003
CREATE TABLE "MarketingBroadcastIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "MarketingBroadcastIntent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingBroadcastIntent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MarketingBroadcastIntentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "intentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingBroadcastIntentVersion_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "MarketingBroadcastIntent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "MarketingBroadcastIntent_businessId_idempotencyKey_key" ON "MarketingBroadcastIntent"("businessId", "idempotencyKey");
CREATE UNIQUE INDEX "MarketingBroadcastIntent_businessId_code_key" ON "MarketingBroadcastIntent"("businessId", "code");
CREATE INDEX "MarketingBroadcastIntent_tenantId_businessId_status_idx" ON "MarketingBroadcastIntent"("tenantId", "businessId", "status");
CREATE UNIQUE INDEX "MarketingBroadcastIntentVersion_intentId_revision_key" ON "MarketingBroadcastIntentVersion"("intentId", "revision");
