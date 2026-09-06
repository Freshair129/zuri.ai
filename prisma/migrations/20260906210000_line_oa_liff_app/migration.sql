-- @req FR-153 — LineOaLiffApp, the LIFF app registry of one LINE OA Studio
-- account (SRS LOS-RQ-070). Twin of supabase/migrations/20260906210000_line_oa_liff_app.sql.
-- @spec BR-002 (liffId is an attribute, unique per account, never a key); SEC-001
-- Additive: one new table, its indexes and foreign keys; nothing existing changes.

-- CreateTable
CREATE TABLE "LineOaLiffApp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lineOaAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "viewSize" TEXT NOT NULL DEFAULT 'FULL',
    "endpointUrl" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL DEFAULT '[]',
    "botPrompt" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "externalLiffId" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "LineOaLiffApp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaLiffApp_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaLiffApp_lineOaAccountId_fkey" FOREIGN KEY ("lineOaAccountId") REFERENCES "LineOaAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LineOaLiffApp_tenantId_code_key" ON "LineOaLiffApp"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaLiffApp_lineOaAccountId_externalLiffId_key" ON "LineOaLiffApp"("lineOaAccountId", "externalLiffId");

-- CreateIndex
CREATE INDEX "LineOaLiffApp_lineOaAccountId_status_idx" ON "LineOaLiffApp"("lineOaAccountId", "status");
