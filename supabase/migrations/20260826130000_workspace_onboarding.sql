-- @req FR-066, FR-067 — profile-first onboarding and the Workspace
-- collaboration boundary: Person.profileCompletedAt, WorkspaceMembership and
-- WorkspaceInvite. WorkspaceMembership binds to "Portfolio" (ADR-027 §D2/D5):
-- the user-facing top-level Workspace IS schema Portfolio, never schema
-- "Workspace", which is a Space one level below Business.
-- @spec BR-016, SEC-014, SDD-038
-- @tested tests/integration/workspace-onboarding-flow.test.js
--
-- BR-016: both tables are a DISTINCT authority layer — resolveViewer never
-- reads them, so a WorkspaceMembership grants nothing on the existing viewer
-- contract. SEC-014: WorkspaceInvite stores only the SHA-256 token digest; the
-- raw token appears exactly once in the authenticated mint response.
--
-- Created after the canonical IAM runtime-role cutover
-- (20260822204604_canonical_iam_runtime_role_cutover.sql): zuri_app_runtime
-- table access arrives via ALTER DEFAULT PRIVILEGES, but RLS enablement and the
-- row policy are per-table, so both are created explicitly below in that
-- migration's own zuri_app_runtime_all shape.

BEGIN;

ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "profileCompletedAt" timestamptz;

CREATE TABLE IF NOT EXISTS "WorkspaceMembership" (
  "id" text PRIMARY KEY,
  "portfolioId" text NOT NULL REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "personId" text NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" text NOT NULL DEFAULT 'MEMBER',
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "invitedByPersonId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMembership_portfolioId_personId_key" ON "WorkspaceMembership"("portfolioId", "personId");
CREATE INDEX IF NOT EXISTS "WorkspaceMembership_personId_status_idx" ON "WorkspaceMembership"("personId", "status");
CREATE INDEX IF NOT EXISTS "WorkspaceMembership_portfolioId_status_idx" ON "WorkspaceMembership"("portfolioId", "status");

CREATE TABLE IF NOT EXISTS "WorkspaceInvite" (
  "id" text PRIMARY KEY,
  "portfolioId" text NOT NULL REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "invitedByPersonId" text NOT NULL REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetPersonId" text,
  "invitedEmail" text,
  "role" text NOT NULL DEFAULT 'MEMBER',
  "status" text NOT NULL DEFAULT 'PENDING',
  "tokenHash" text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "acceptedByPersonId" text,
  "acceptedAt" timestamptz,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "WorkspaceInvite_portfolioId_status_idx" ON "WorkspaceInvite"("portfolioId", "status");
CREATE INDEX IF NOT EXISTS "WorkspaceInvite_targetPersonId_status_idx" ON "WorkspaceInvite"("targetPersonId", "status");
CREATE INDEX IF NOT EXISTS "WorkspaceInvite_invitedEmail_status_idx" ON "WorkspaceInvite"("invitedEmail", "status");

ALTER TABLE "WorkspaceMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMembership" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceInvite" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'WorkspaceMembership' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "WorkspaceMembership"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'WorkspaceInvite' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "WorkspaceInvite"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE "WorkspaceMembership" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "WorkspaceInvite" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "WorkspaceMembership" IS
  'FR-067 — Workspace collaboration membership keyed by portfolioId (ADR-027 D2/D5). A distinct authority layer (BR-016): resolveViewer never reads it, and Tenant/Business/Space/Project access remains a separate server-authorized assignment.';
COMMENT ON TABLE "WorkspaceInvite" IS
  'FR-067 — single-use, expiring Workspace invite. Stores only the SHA-256 token digest (SEC-014); the raw token is returned exactly once at mint and never persisted or logged.';

COMMIT;
