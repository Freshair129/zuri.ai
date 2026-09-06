BEGIN;
-- @req FR-157; @spec SDD-088 — private runtime policy; application scope enforced by service.
-- CreateTable
CREATE TABLE "MarketingContentBrief" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingContentBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentVersion" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentReview" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "rightsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "brandConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingContentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentDecision" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "reviewId" TEXT,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingContentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingContentBrief_tenantId_businessId_status_idx" ON "MarketingContentBrief"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentBrief_businessId_code_key" ON "MarketingContentBrief"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentVersion_briefId_revision_key" ON "MarketingContentVersion"("briefId", "revision");

-- CreateIndex
CREATE INDEX "MarketingContentReview_briefId_createdAt_idx" ON "MarketingContentReview"("briefId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingContentDecision_briefId_createdAt_idx" ON "MarketingContentDecision"("briefId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketingContentBrief" ADD CONSTRAINT "MarketingContentBrief_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentBrief" ADD CONSTRAINT "MarketingContentBrief_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentVersion" ADD CONSTRAINT "MarketingContentVersion_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentReview" ADD CONSTRAINT "MarketingContentReview_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentReview" ADD CONSTRAINT "MarketingContentReview_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentDecision" ADD CONSTRAINT "MarketingContentDecision_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentDecision" ADD CONSTRAINT "MarketingContentDecision_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentDecision" ADD CONSTRAINT "MarketingContentDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "MarketingContentReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "MarketingContentBrief" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingContentBrief" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingContentBrief" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingContentBrief" FROM public, anon, authenticated, service_role;

ALTER TABLE "MarketingContentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingContentVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingContentVersion" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingContentVersion" FROM public, anon, authenticated, service_role;

ALTER TABLE "MarketingContentReview" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingContentReview" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingContentReview" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingContentReview" FROM public, anon, authenticated, service_role;

ALTER TABLE "MarketingContentDecision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingContentDecision" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "MarketingContentDecision" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "MarketingContentDecision" FROM public, anon, authenticated, service_role;
COMMIT;
