-- FR-294: additive design registry only. Apply through the target release migration gates.
BEGIN;
-- CreateTable
CREATE TABLE "OfficeDesignRegistry" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeDesignRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeDesignIdentity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "semanticKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeDesignIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeDesignRevision" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "archiveSha256" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "producerRevision" TEXT NOT NULL,
    "createdByPersonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeDesignRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeDesignBlob" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'model/gltf-binary',
    "byteLength" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeDesignBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeDesignImportReceipt" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "commandHash" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeDesignImportReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesignRegistry_code_key" ON "OfficeDesignRegistry"("code");

-- CreateIndex
CREATE INDEX "OfficeDesignRegistry_tenantId_businessId_idx" ON "OfficeDesignRegistry"("tenantId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesignRegistry_workspaceId_source_packageId_key" ON "OfficeDesignRegistry"("workspaceId", "source", "packageId");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesignIdentity_code_key" ON "OfficeDesignIdentity"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesignIdentity_registryId_externalId_key" ON "OfficeDesignIdentity"("registryId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesignIdentity_registryId_kind_semanticKey_key" ON "OfficeDesignIdentity"("registryId", "kind", "semanticKey");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesignRevision_registryId_version_key" ON "OfficeDesignRevision"("registryId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesignBlob_registryId_sha256_key" ON "OfficeDesignBlob"("registryId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "OfficeDesignImportReceipt_registryId_requestKey_key" ON "OfficeDesignImportReceipt"("registryId", "requestKey");

-- AddForeignKey
ALTER TABLE "OfficeDesignRegistry" ADD CONSTRAINT "OfficeDesignRegistry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDesignRegistry" ADD CONSTRAINT "OfficeDesignRegistry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDesignRegistry" ADD CONSTRAINT "OfficeDesignRegistry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDesignIdentity" ADD CONSTRAINT "OfficeDesignIdentity_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "OfficeDesignRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDesignRevision" ADD CONSTRAINT "OfficeDesignRevision_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "OfficeDesignRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDesignBlob" ADD CONSTRAINT "OfficeDesignBlob_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "OfficeDesignRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDesignImportReceipt" ADD CONSTRAINT "OfficeDesignImportReceipt_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "OfficeDesignRegistry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


COMMIT;
