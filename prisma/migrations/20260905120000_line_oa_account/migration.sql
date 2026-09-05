-- @req FR-146 — LineOaAccount, the LINE OA Studio account aggregate: one row per
-- LINE Official Account a Business operates, many per Business, one Business each.
-- @spec ADR-060 D2, D3, D5, D11; BR-002; SEC-001
-- Additive: one new table, its indexes and foreign keys; nothing existing changes.

CREATE TABLE "LineOaAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "integrationConnectionId" TEXT NOT NULL,
    "bindingCode" TEXT,
    "displayName" TEXT NOT NULL,
    "basicId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "transportMode" TEXT NOT NULL DEFAULT 'CLOUD',
    "isDefaultForBusiness" BOOLEAN NOT NULL DEFAULT false,
    "botProfileJson" TEXT NOT NULL DEFAULT '{}',
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "LineOaAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaAccount_integrationConnectionId_fkey" FOREIGN KEY ("integrationConnectionId") REFERENCES "IntegrationConnection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LineOaAccount_integrationConnectionId_key" ON "LineOaAccount"("integrationConnectionId");
CREATE UNIQUE INDEX "LineOaAccount_tenantId_code_key" ON "LineOaAccount"("tenantId", "code");
CREATE UNIQUE INDEX "LineOaAccount_tenantId_bindingCode_key" ON "LineOaAccount"("tenantId", "bindingCode");
CREATE INDEX "LineOaAccount_businessId_status_idx" ON "LineOaAccount"("businessId", "status");
