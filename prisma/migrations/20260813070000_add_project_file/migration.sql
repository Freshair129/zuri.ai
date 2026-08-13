-- FR-037 additive migration artifact. The local SQLite workflow is db:push;
-- see docs/features/FR-037-project-files.md for the missing-baseline boundary.
CREATE TABLE "ProjectFile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "workItemId" TEXT,
  "name" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "url" TEXT,
  "blobRef" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "uploadedBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectFile_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectFile_code_key" ON "ProjectFile"("code");
CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");
CREATE INDEX "ProjectFile_workItemId_idx" ON "ProjectFile"("workItemId");
