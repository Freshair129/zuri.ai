-- @req FR-152 — LineOaRichMenuJob, the server-owned rich menu publish ledger
-- (ADR-061 D1/D6/D7): PUBLISH a frozen version, SET_DEFAULT or SET_ALIAS a
-- published one; claimed with compare-and-set and a lease; an ambiguous
-- create ends UNKNOWN. Twin of supabase/migrations/20260906180000_line_oa_rich_menu_job.sql.
-- @spec ADR-061 D1, D6, D7; SEC-001; BR-002
-- Additive: one new table, its indexes and foreign keys; nothing existing changes.

-- CreateTable
CREATE TABLE "LineOaRichMenuJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "richMenuId" TEXT NOT NULL,
    "richMenuVersionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'CREATE',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "transportEpoch" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "claimantId" TEXT,
    "leaseExpiresAt" DATETIME,
    "externalRichMenuId" TEXT,
    "providerRequestId" TEXT,
    "errorCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "LineOaRichMenuJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LineOaAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaRichMenuJob_richMenuId_fkey" FOREIGN KEY ("richMenuId") REFERENCES "LineOaRichMenu" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaRichMenuJob_richMenuVersionId_fkey" FOREIGN KEY ("richMenuVersionId") REFERENCES "LineOaRichMenuVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LineOaRichMenuJob_status_availableAt_idx" ON "LineOaRichMenuJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "LineOaRichMenuJob_accountId_status_idx" ON "LineOaRichMenuJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "LineOaRichMenuJob_richMenuId_status_idx" ON "LineOaRichMenuJob"("richMenuId", "status");
