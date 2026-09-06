-- @req FR-157; @spec SDD-088
-- CreateTable
CREATE TABLE "MarketingContentBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "MarketingContentBrief_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingContentBrief_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketingContentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingContentVersion_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketingContentReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "rightsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "brandConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingContentReview_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingContentReview_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketingContentDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reviewId" TEXT,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingContentDecision_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingContentDecision_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MarketingContentDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "MarketingContentReview" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "MarketingContentReview_briefId_sequence_key" ON "MarketingContentReview"("briefId", "sequence");

-- CreateIndex
CREATE INDEX "MarketingContentDecision_briefId_createdAt_idx" ON "MarketingContentDecision"("briefId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentDecision_briefId_sequence_key" ON "MarketingContentDecision"("briefId", "sequence");

