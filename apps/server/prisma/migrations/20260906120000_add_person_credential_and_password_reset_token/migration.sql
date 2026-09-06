-- @req FR-076, FR-122 — PersonCredential and PasswordResetToken, the password-
-- auth tables declared in prisma/schema.prisma at 9a149d6 (2026-08-19) because
-- production already had them. They reached the local database through
-- `prisma db push` and never had a file in this history; this is the parity
-- twin of supabase/migrations/20260906120000_record_pre_lineage_tables_and_columns.sql
-- (PlanImportReceipt and the Workstream columns already have theirs here:
-- 20260818090000_add_plan_identity_contract).
-- @spec docs/DB-MIGRATION-NOTES.md §Migration discipline
-- Additive: two tables, their indexes and foreign keys; nothing existing changes.

-- CreateTable
CREATE TABLE "PersonCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PersonCredential_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonCredential_personId_key" ON "PersonCredential"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_personId_idx" ON "PasswordResetToken"("personId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");
