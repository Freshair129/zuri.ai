-- @req FR-236 — KnowledgeCandidate, a LINE FAQ knowledge candidate (knowledge).
-- Twin of supabase/migrations/20260914150200_knowledge_candidate.sql.
-- @spec ADR-090 D6, D8; ADR-072; SEC-032; BR-002
-- Additive: one new table, its indexes and foreign keys; nothing existing changes.

-- CreateTable
CREATE TABLE "KnowledgeCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sourceRefJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "consentStatusAtDraft" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdByPersonId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "decidedByPersonId" TEXT,
    "decidedAt" DATETIME,
    "decisionReason" TEXT,
    "admittedSourceId" TEXT,
    "admittedIngestionId" TEXT,
    "tombstonedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "KnowledgeCandidate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeCandidate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeCandidate_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCandidate_businessId_idempotencyKey_key" ON "KnowledgeCandidate"("businessId", "idempotencyKey");
CREATE INDEX "KnowledgeCandidate_businessId_status_idx" ON "KnowledgeCandidate"("businessId", "status");
CREATE INDEX "KnowledgeCandidate_conversationId_idx" ON "KnowledgeCandidate"("conversationId");
