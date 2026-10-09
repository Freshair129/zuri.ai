-- @req FR-057 — trusted API-010 scope is publisher-selected per LINE OA account.
ALTER TABLE "LineOaAccount" ADD COLUMN "memoryProjectId" TEXT;
ALTER TABLE "LineConversationJob" ADD COLUMN "episodicWorkspaceId" TEXT;
ALTER TABLE "LineConversationJob" ADD COLUMN "episodicProjectId" TEXT;

ALTER TABLE "LineOaAccount"
  ADD CONSTRAINT "LineOaAccount_memoryProjectId_fkey"
  FOREIGN KEY ("memoryProjectId") REFERENCES "Project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LineOaAccount_memoryProjectId_idx" ON "LineOaAccount"("memoryProjectId");
