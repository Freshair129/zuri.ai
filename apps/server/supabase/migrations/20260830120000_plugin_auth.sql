-- @req FR-123 — the first-party plugin authorization boundary: a public-client
-- installation binding, a single-use PKCE-bound authorization code, and a
-- short-lived opaque plugin session. Distinct from FR-106's `ApiAccessKey`,
-- which is a long-lived Tenant-scoped service credential; this is a per-Person
-- delegation that expires in minutes.
-- @spec ADR-052, SDD-074, SEC-022, SEC-006
-- @tested tests/unit/fr123-plugin-auth-migration.test.js
--
-- No raw credential is ever stored. `PluginAuthorizationCode.codeHash` and
-- `PluginSession.tokenHash` hold SHA-256 digests of high-entropy random values
-- that only the client ever sees in the clear; a database read cannot recover
-- a usable code or token.
--
-- Additive and idempotent by construction (CREATE TABLE IF NOT EXISTS, CREATE
-- INDEX IF NOT EXISTS, a policy guarded by a pg_policies lookup), because it is
-- not established whether an earlier draft of this migration was ever applied
-- to the live database — the worktree it was written in was removed. Re-running
-- it against a database that already carries these tables is a no-op rather
-- than an error.
--
-- Created after the canonical IAM runtime-role cutover
-- (20260822204604_canonical_iam_runtime_role_cutover.sql), which granted
-- zuri_app_runtime table access via ALTER DEFAULT PRIVILEGES FOR ROLE postgres,
-- so these tables inherit that grant from the migration-executor role. What
-- ALTER DEFAULT PRIVILEGES does not cover is RLS enablement or a row policy, so
-- both are created explicitly, matching the shape used by
-- 20260826150000_api_access_key.sql and 20260824120000_sot_data_plane_key.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS "PluginInstallation" (
  "id" text PRIMARY KEY,
  "installationId" text NOT NULL UNIQUE,
  "clientId" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PluginInstallation_clientId_status_idx"
  ON "PluginInstallation"("clientId", "status");

CREATE TABLE IF NOT EXISTS "PluginAuthorizationCode" (
  "id" text PRIMARY KEY,
  "codeHash" text NOT NULL UNIQUE,
  "clientId" text NOT NULL,
  "redirectUri" text NOT NULL,
  "codeChallenge" text NOT NULL,
  "codeChallengeMethod" text NOT NULL DEFAULT 'S256',
  "pluginInstallationId" text NOT NULL REFERENCES "PluginInstallation"("id") ON DELETE CASCADE,
  "personId" text NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE,
  "expiresAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "PluginAuthorizationCode_pluginInstallationId_expiresAt_idx"
  ON "PluginAuthorizationCode"("pluginInstallationId", "expiresAt");
CREATE INDEX IF NOT EXISTS "PluginAuthorizationCode_personId_expiresAt_idx"
  ON "PluginAuthorizationCode"("personId", "expiresAt");

CREATE TABLE IF NOT EXISTS "PluginSession" (
  "id" text PRIMARY KEY,
  "tokenHash" text NOT NULL UNIQUE,
  "clientId" text NOT NULL,
  "pluginInstallationId" text NOT NULL REFERENCES "PluginInstallation"("id") ON DELETE CASCADE,
  "personId" text NOT NULL REFERENCES "Person"("id") ON DELETE CASCADE,
  "authorizationCodeId" text,
  "expiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  "lastUsedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- Stated separately as well as inline, because CREATE TABLE IF NOT EXISTS is
-- silent on a table that already exists with a different shape. An earlier
-- draft of this boundary created "PluginSession" without this column, and it is
-- not established whether that draft ever reached the live database. Without
-- this line, a database carrying the older table would keep the older shape and
-- the replay-revocation path would fail at runtime, not at migration time.
ALTER TABLE "PluginSession" ADD COLUMN IF NOT EXISTS "authorizationCodeId" text;

CREATE INDEX IF NOT EXISTS "PluginSession_pluginInstallationId_expiresAt_idx"
  ON "PluginSession"("pluginInstallationId", "expiresAt");
CREATE INDEX IF NOT EXISTS "PluginSession_personId_expiresAt_idx"
  ON "PluginSession"("personId", "expiresAt");
CREATE INDEX IF NOT EXISTS "PluginSession_authorizationCodeId_idx"
  ON "PluginSession"("authorizationCodeId");

ALTER TABLE "PluginInstallation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PluginInstallation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PluginAuthorizationCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PluginAuthorizationCode" FORCE ROW LEVEL SECURITY;
ALTER TABLE "PluginSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PluginSession" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['PluginInstallation', 'PluginAuthorizationCode', 'PluginSession'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)',
        target
      );
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON TABLE "PluginInstallation" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "PluginAuthorizationCode" FROM public, anon, authenticated, service_role;
REVOKE ALL ON TABLE "PluginSession" FROM public, anon, authenticated, service_role;

COMMENT ON TABLE "PluginInstallation" IS
  'FR-123 — a first-party plugin installation binding for one public client. Never exposed to anon/authenticated Data API roles.';
COMMENT ON TABLE "PluginAuthorizationCode" IS
  'FR-123 — single-use PKCE-bound authorization codes. The raw code is never stored, only its SHA-256 hash; consumption is an atomic conditional update.';
COMMENT ON TABLE "PluginSession" IS
  'FR-123 — short-lived opaque plugin bearer sessions. The raw token is never stored, only its SHA-256 hash; revocation is idempotent.';

COMMIT;
