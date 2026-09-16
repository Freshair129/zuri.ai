-- FR-172 / ADR-072: additive admission storage; no production apply implied.
BEGIN;
-- CreateTable
CREATE TABLE "KnowledgeCorpus" (
    "id" TEXT NOT NULL,
    "corpusKey" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "projectId" TEXT,
    "workspaceId" TEXT NOT NULL DEFAULT '',
    "scopeJson" TEXT NOT NULL,
    "policyJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeCorpus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileAssetId" TEXT,
    "desiredRevision" INTEGER NOT NULL DEFAULT 0,
    "activeIngestionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeIngestion" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceMetaJson" TEXT NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "submittedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "executionRunId" TEXT,
    "rawArtifactId" TEXT,
    "parsedArtifactId" TEXT,
    "snapshotId" TEXT,
    "snapshotGeneration" TEXT,
    "receiptHash" TEXT,
    "claimToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeIngestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCorpusGeneration" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCorpusGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCorpus_corpusKey_key" ON "KnowledgeCorpus"("corpusKey");

-- CreateIndex
CREATE INDEX "KnowledgeCorpus_tenantId_businessId_projectId_idx" ON "KnowledgeCorpus"("tenantId", "businessId", "projectId");

-- CreateIndex
CREATE INDEX "KnowledgeSource_fileAssetId_idx" ON "KnowledgeSource"("fileAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_corpusId_sourceKey_key" ON "KnowledgeSource"("corpusId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeIngestion_idempotencyKey_key" ON "KnowledgeIngestion"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeIngestion_executionRunId_key" ON "KnowledgeIngestion"("executionRunId");

-- CreateIndex
CREATE INDEX "KnowledgeIngestion_status_leaseExpiresAt_createdAt_idx" ON "KnowledgeIngestion"("status", "leaseExpiresAt", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeIngestion_corpusId_createdAt_idx" ON "KnowledgeIngestion"("corpusId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeIngestion_sourceId_sourceVersion_key" ON "KnowledgeIngestion"("sourceId", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCorpusGeneration_corpusId_number_key" ON "KnowledgeCorpusGeneration"("corpusId", "number");

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "KnowledgeCorpus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeIngestion" ADD CONSTRAINT "KnowledgeIngestion_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "KnowledgeCorpus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeIngestion" ADD CONSTRAINT "KnowledgeIngestion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCorpusGeneration" ADD CONSTRAINT "KnowledgeCorpusGeneration_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "KnowledgeCorpus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "KnowledgeCorpus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeCorpus" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "KnowledgeCorpus" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "KnowledgeCorpus" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "KnowledgeCorpus" TO zuri_app_runtime, zuri_web_login;

ALTER TABLE "KnowledgeSource" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeSource" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "KnowledgeSource" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "KnowledgeSource" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "KnowledgeSource" TO zuri_app_runtime, zuri_web_login;

ALTER TABLE "KnowledgeIngestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeIngestion" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "KnowledgeIngestion" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "KnowledgeIngestion" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "KnowledgeIngestion" TO zuri_app_runtime, zuri_web_login;

ALTER TABLE "KnowledgeCorpusGeneration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KnowledgeCorpusGeneration" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "KnowledgeCorpusGeneration" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "KnowledgeCorpusGeneration" FROM public, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "KnowledgeCorpusGeneration" TO zuri_app_runtime, zuri_web_login;

COMMIT;
