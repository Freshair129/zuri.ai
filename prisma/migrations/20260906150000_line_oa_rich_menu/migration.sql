-- @req FR-151 — LineOaRichMenu and LineOaRichMenuVersion, the rich menu
-- designer's data (ADR-060 D3): a menu's identity, alias and default flag, and
-- its numbered bodies, immutable once frozen. Twin of
-- supabase/migrations/20260906150000_line_oa_rich_menu.sql.
-- @spec ADR-060 D3, D6, D11; BR-002; SEC-001
-- Additive: two new tables, their indexes and foreign keys; nothing existing changes.

-- CreateTable
CREATE TABLE "LineOaRichMenu" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lineOaAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "LineOaRichMenu_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaRichMenu_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaRichMenu_lineOaAccountId_fkey" FOREIGN KEY ("lineOaAccountId") REFERENCES "LineOaAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LineOaRichMenuVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "richMenuId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lineOaAccountId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "layout" TEXT NOT NULL,
    "chatBarText" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "imageFileAssetId" TEXT,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "areasJson" TEXT NOT NULL DEFAULT '[]',
    "externalRichMenuId" TEXT,
    "frozenAt" DATETIME,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LineOaRichMenuVersion_richMenuId_fkey" FOREIGN KEY ("richMenuId") REFERENCES "LineOaRichMenu" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineOaRichMenuVersion_imageFileAssetId_fkey" FOREIGN KEY ("imageFileAssetId") REFERENCES "FileAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LineOaRichMenu_tenantId_code_key" ON "LineOaRichMenu"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaRichMenu_lineOaAccountId_alias_key" ON "LineOaRichMenu"("lineOaAccountId", "alias");

-- CreateIndex
CREATE INDEX "LineOaRichMenu_lineOaAccountId_status_idx" ON "LineOaRichMenu"("lineOaAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaRichMenuVersion_richMenuId_versionNumber_key" ON "LineOaRichMenuVersion"("richMenuId", "versionNumber");

-- CreateIndex
CREATE INDEX "LineOaRichMenuVersion_lineOaAccountId_status_idx" ON "LineOaRichMenuVersion"("lineOaAccountId", "status");
