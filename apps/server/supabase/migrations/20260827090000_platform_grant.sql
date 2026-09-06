-- @req FR-107 — the server-held store behind FR-075's `isOperator` capability.
-- A row here is the only thing that makes a web session an installation
-- operator; the session port reads it per request, so revocation denies the
-- very next request. Never exposed to the Supabase Data API.
-- @spec FR-075, SEC-008
-- @tested tests/unit/platform-grant-migration.test.js
--
-- Created after the canonical IAM runtime-role cutover
-- (20260822204604_canonical_iam_runtime_role_cutover.sql): zuri_app_runtime
-- table access arrives via ALTER DEFAULT PRIVILEGES, but RLS enablement and
-- the row policy are per-table, so both are created explicitly below in that
-- migration's own zuri_app_runtime_all shape.

BEGIN;

CREATE TABLE IF NOT EXISTS "PlatformGrant" (
  "id" text PRIMARY KEY,
  "personId" text NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE,
  "capability" text NOT NULL DEFAULT 'OPERATOR',
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "grantedByPersonId" text REFERENCES "Person"("id") ON DELETE SET NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "revokedAt" timestamptz,
  "revokeReason" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformGrant_personId_capability_key" ON "PlatformGrant"("personId", "capability");
CREATE INDEX IF NOT EXISTS "PlatformGrant_capability_status_idx" ON "PlatformGrant"("capability", "status");

ALTER TABLE "PlatformGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformGrant" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'PlatformGrant' AND policyname = 'zuri_app_runtime_all'
  ) THEN
    CREATE POLICY zuri_app_runtime_all ON "PlatformGrant"
      FOR ALL TO zuri_app_runtime, zuri_web_login
      USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE "PlatformGrant" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "PlatformGrant" IS
  'FR-107 — server-held installation-operator grants (FR-075 isOperator). Resolved per request by the session port; revocation takes effect on the next request. Never exposed to anon/authenticated Data API roles.';

COMMIT;
