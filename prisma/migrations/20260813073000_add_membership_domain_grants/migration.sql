-- FR-038 additive migration artifact. The local SQLite workflow is db:push;
-- see docs/features/FR-038-profile-and-permissions.md for the baseline boundary.
ALTER TABLE "Membership" ADD COLUMN "domainKeysJson" TEXT NOT NULL DEFAULT '[]';
