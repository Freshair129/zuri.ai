-- FR-094..FR-098 / ADR-045 / SDD-052 / SEC-018 — additive Phase 0 IAM contract.
--
-- The local repository has no migration baseline; this artifact documents the
-- inspected db:push delta. Apply to a live Postgres/Supabase database only
-- through the production migration gate after backup, privilege and row-count
-- checks. No provider or session data is copied by this file.

ALTER TABLE "Membership" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Membership" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Membership" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "Membership_personId_status_idx" ON "Membership"("personId", "status");
CREATE INDEX "Membership_tenantId_status_idx" ON "Membership"("tenantId", "status");

CREATE TABLE "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "personId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "assurance" TEXT NOT NULL DEFAULT 'PASSWORD',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "revokedAt" DATETIME,
  "revokeReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "Session_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_personId_status_idx" ON "Session"("personId", "status");
CREATE INDEX "Session_expiresAt_status_idx" ON "Session"("expiresAt", "status");

CREATE TABLE "ChannelIdentity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "personId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "channelAccountId" TEXT NOT NULL,
  "providerSubject" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "verifiedAt" DATETIME,
  "linkedAt" DATETIME,
  "revokedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ChannelIdentity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChannelIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ChannelIdentity_tenantId_channel_channelAccountId_providerSubject_key"
  ON "ChannelIdentity"("tenantId", "channel", "channelAccountId", "providerSubject");
CREATE INDEX "ChannelIdentity_personId_status_idx" ON "ChannelIdentity"("personId", "status");
CREATE INDEX "ChannelIdentity_tenantId_status_idx" ON "ChannelIdentity"("tenantId", "status");
