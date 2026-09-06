-- FR-045 / ADR-016 / ZV2-CR-001 W1 additive metadata schema.
-- ProjectFile remains untouched for the compatibility window; W1 performs no backfill.
CREATE TABLE "LocalWorkspaceMount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "deviceKey" TEXT NOT NULL,
  "rootPath" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "lastScanAt" DATETIME,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LocalWorkspaceMount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LocalWorkspaceMount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FileAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "projectId" TEXT,
  "workItemId" TEXT,
  "storageKind" TEXT NOT NULL,
  "relativePath" TEXT,
  "externalUrl" TEXT,
  "blobRef" TEXT,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "sha256" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "uploadedBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "deletedAt" DATETIME,
  CONSTRAINT "FileAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FileAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FileAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FileAsset_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "FileLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "fileId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FileLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LocalWorkspaceMount_businessId_deviceKey_key" ON "LocalWorkspaceMount"("businessId", "deviceKey");
CREATE INDEX "LocalWorkspaceMount_tenantId_idx" ON "LocalWorkspaceMount"("tenantId");
CREATE UNIQUE INDEX "FileAsset_code_key" ON "FileAsset"("code");
CREATE INDEX "FileAsset_tenantId_idx" ON "FileAsset"("tenantId");
CREATE INDEX "FileAsset_businessId_idx" ON "FileAsset"("businessId");
CREATE INDEX "FileAsset_projectId_idx" ON "FileAsset"("projectId");
CREATE INDEX "FileAsset_workItemId_idx" ON "FileAsset"("workItemId");
CREATE UNIQUE INDEX "FileLink_fileId_entityType_entityId_relationType_key" ON "FileLink"("fileId", "entityType", "entityId", "relationType");
CREATE INDEX "FileLink_entityType_entityId_idx" ON "FileLink"("entityType", "entityId");
