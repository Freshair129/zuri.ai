-- FR-066/FR-067 — profile-first onboarding and the Workspace collaboration boundary.
--
-- Person.profileCompletedAt: the FR-066 Profile completion marker — an identity
-- step over Person (ADR-027 D1), never an authorization grant (BR-016).
ALTER TABLE "Person" ADD COLUMN "profileCompletedAt" DATETIME;

-- WorkspaceMembership binds to portfolioId (ADR-027 §D2/D5): the user-facing
-- top-level Workspace IS schema Portfolio, never schema Workspace (= Space).
-- A distinct authority layer (BR-016): resolveViewer never reads this table.
CREATE TABLE "WorkspaceMembership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "portfolioId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "invitedByPersonId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "WorkspaceMembership_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceMembership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkspaceMembership_portfolioId_personId_key" ON "WorkspaceMembership"("portfolioId", "personId");
CREATE INDEX "WorkspaceMembership_personId_status_idx" ON "WorkspaceMembership"("personId", "status");
CREATE INDEX "WorkspaceMembership_portfolioId_status_idx" ON "WorkspaceMembership"("portfolioId", "status");

-- WorkspaceInvite stores only the SHA-256 token digest (SEC-014, the FR-104
-- discipline); the raw token is returned exactly once at mint. EXPIRED is not a
-- persisted status — expiry is compared against expiresAt at acceptance, fail-closed.
CREATE TABLE "WorkspaceInvite" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "portfolioId" TEXT NOT NULL,
  "invitedByPersonId" TEXT NOT NULL,
  "targetPersonId" TEXT,
  "invitedEmail" TEXT,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "acceptedByPersonId" TEXT,
  "acceptedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "WorkspaceInvite_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceInvite_invitedByPersonId_fkey" FOREIGN KEY ("invitedByPersonId") REFERENCES "Person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");
CREATE INDEX "WorkspaceInvite_portfolioId_status_idx" ON "WorkspaceInvite"("portfolioId", "status");
CREATE INDEX "WorkspaceInvite_targetPersonId_status_idx" ON "WorkspaceInvite"("targetPersonId", "status");
CREATE INDEX "WorkspaceInvite_invitedEmail_status_idx" ON "WorkspaceInvite"("invitedEmail", "status");
