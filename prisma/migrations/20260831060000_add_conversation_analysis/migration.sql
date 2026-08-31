-- FR-127 / ADR-054 D3-D6 — derived CRM conversation analysis.
-- The internal Conversation id is the only source identity; tenant/business
-- scope is inherited through that row. `analyzedDate` is a grouping index, not
-- a uniqueness key: every analysis run gets its own generated id.
CREATE TABLE "ConversationAnalysis" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "analyzedDate" DATETIME NOT NULL,
  "analyzedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contactType" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "cta" TEXT,
  "tags" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "rawOutputJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ConversationAnalysis_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ConversationAnalysis_conversationId_analyzedDate_idx"
  ON "ConversationAnalysis"("conversationId", "analyzedDate");
CREATE INDEX "ConversationAnalysis_analyzedDate_idx"
  ON "ConversationAnalysis"("analyzedDate");
CREATE INDEX "ConversationAnalysis_contactType_idx"
  ON "ConversationAnalysis"("contactType");
CREATE INDEX "ConversationAnalysis_state_idx"
  ON "ConversationAnalysis"("state");
