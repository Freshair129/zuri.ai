-- @req FR-110 — KnowledgeEvidenceCursor: zuri-ai's own per-scope cursor into
-- GKS's gks_stage_evidence_export (ADR-068 D2). Twin of
-- supabase/migrations/20260907120000_knowledge_evidence_cursor.sql.
-- @spec ADR-068; ADR-050 D3; SEC-001
-- Additive: one new table and its indexes; nothing existing changes.

-- CreateTable
CREATE TABLE "KnowledgeEvidenceCursor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sharing" TEXT NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "lastPulledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEvidenceCursor_portfolioId_tenantId_businessId_workspaceId_projectId_sharing_key" ON "KnowledgeEvidenceCursor"("portfolioId", "tenantId", "businessId", "workspaceId", "projectId", "sharing");
CREATE INDEX "KnowledgeEvidenceCursor_tenantId_idx" ON "KnowledgeEvidenceCursor"("tenantId");
