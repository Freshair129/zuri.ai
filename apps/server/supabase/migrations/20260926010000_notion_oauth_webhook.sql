-- @req FR-273, FR-274 — Notion OAuth state, encrypted webhook setup token and
-- minimal event receipts. Token ciphertext and ephemeral state are excluded from
-- snapshots; receipts preserve webhook idempotency.
-- @spec ADR-109 D1-D3; SDD-108; SDD-109; SEC-037
-- Additive provider migration. It is NOT APPLIED by this change.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('zuri:notion-oauth-webhook:v1'));

DO $precondition_guard$
BEGIN
  IF to_regnamespace('zuri_core') IS NULL
    OR to_regclass('public."IntegrationConnection"') IS NULL
    OR to_regclass('public."IntegrationCredential"') IS NULL
    OR to_regclass('public."IntegrationCredentialVersion"') IS NULL
    OR to_regprocedure('zuri_core.channel_secret_activate(text, text, text, integer, text)') IS NULL
    OR to_regprocedure('zuri_core.channel_secret_revoke(text, text, text, text, integer)') IS NULL
    OR to_regprocedure('zuri_core.channel_secret_purge_version(text, text)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuri_channel_vault_writer')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuri_channel_vault_reader')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuri_app_runtime')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zuri_web_login') THEN
    RAISE EXCEPTION 'NOTION_OAUTH_WEBHOOK_PRECONDITION_FAILED: Integration/Vault migrations and app roles must exist first';
  END IF;
  IF to_regclass('vault.secrets') IS NULL
    OR to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT has_table_privilege(current_user, 'vault.decrypted_secrets', 'select')
    OR NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'vault' AND p.proname = 'create_secret'
    ) THEN
    RAISE EXCEPTION 'NOTION_OAUTH_WEBHOOK_PRECONDITION_FAILED: migration executor must read Vault and call vault.create_secret';
  END IF;
END
$precondition_guard$;

CREATE TABLE IF NOT EXISTS public."NotionOAuthState" (
  "id" text PRIMARY KEY,
  "stateHash" text NOT NULL UNIQUE,
  "tenantId" text NOT NULL,
  "businessId" text NOT NULL,
  "actorId" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "consumedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "NotionOAuthState_expiresAt_idx" ON public."NotionOAuthState"("expiresAt");
CREATE INDEX IF NOT EXISTS "NotionOAuthState_tenantId_businessId_actorId_idx"
  ON public."NotionOAuthState"("tenantId", "businessId", "actorId");

CREATE TABLE IF NOT EXISTS public."NotionWebhookVerificationToken" (
  "id" text PRIMARY KEY,
  "kekId" text NOT NULL,
  "wrappedDek" text NOT NULL,
  "iv" text NOT NULL,
  "tag" text NOT NULL,
  "ciphertext" text NOT NULL,
  "revealedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public."NotionWebhookReceipt" (
  "eventId" text PRIMARY KEY,
  "eventType" text NOT NULL,
  "workspaceId" text NOT NULL,
  "occurredAt" timestamptz NOT NULL,
  "receivedAt" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "NotionWebhookReceipt_workspaceId_receivedAt_idx"
  ON public."NotionWebhookReceipt"("workspaceId", "receivedAt");
CREATE INDEX IF NOT EXISTS "NotionWebhookReceipt_occurredAt_idx"
  ON public."NotionWebhookReceipt"("occurredAt");

DO $rls$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['NotionOAuthState', 'NotionWebhookVerificationToken', 'NotionWebhookReceipt'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM public, anon, authenticated, service_role', v_table);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format('CREATE POLICY zuri_app_runtime_all ON public.%I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)', v_table);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO zuri_app_runtime, zuri_web_login', v_table);
  END LOOP;
END
$rls$;

CREATE OR REPLACE FUNCTION zuri_core.notion_secret_write(
  p_connection_id text,
  p_tenant_id text,
  p_business_id text,
  p_bundle jsonb,
  p_expires_at timestamptz,
  p_actor_person_id text,
  p_created_via text
)
RETURNS TABLE (secret_ref text, version_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_connection_id text;
  v_credential public."IntegrationCredential"%rowtype;
  v_next integer;
  v_secret_id uuid;
  v_ref text;
  v_pending record;
BEGIN
  IF p_created_via IS NULL OR p_created_via NOT IN ('BROWSER_MFA', 'OPERATOR_CLI')
    OR p_bundle IS NULL OR jsonb_typeof(p_bundle) <> 'object'
    OR NOT (p_bundle ? 'accessToken') OR NOT (p_bundle ? 'refreshToken')
    OR coalesce(p_bundle->>'accessToken', '') !~ '^[!-~]+$'
    OR length(p_bundle->>'accessToken') NOT BETWEEN 1 AND 4096
    OR jsonb_typeof(p_bundle->'refreshToken') NOT IN ('string', 'null')
    OR (jsonb_typeof(p_bundle->'refreshToken') = 'string'
      AND (coalesce(p_bundle->>'refreshToken', '') !~ '^[!-~]+$'
        OR length(p_bundle->>'refreshToken') NOT BETWEEN 1 AND 4096))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_bundle) k WHERE k NOT IN ('accessToken', 'refreshToken')) THEN
    RAISE EXCEPTION 'CHANNEL_SECRET_BUNDLE_INVALID';
  END IF;

  SELECT c."id" INTO v_connection_id
  FROM public."IntegrationConnection" c
  WHERE c."id" = p_connection_id
    AND c."tenantId" = p_tenant_id
    AND c."businessId" = p_business_id
    AND c."authorizationType" = 'SECRET_MANAGER'
  FOR UPDATE;
  IF v_connection_id IS NULL THEN RAISE EXCEPTION 'CHANNEL_SECRET_SCOPE_MISMATCH'; END IF;

  SELECT * INTO v_credential
  FROM public."IntegrationCredential" cr
  WHERE cr."connectionId" = p_connection_id
  FOR UPDATE;
  IF v_credential."id" IS NOT NULL AND v_credential."secretKind" IS DISTINCT FROM 'NOTION_OAUTH_TOKEN' THEN
    RAISE EXCEPTION 'CREDENTIAL_KIND_MISMATCH';
  END IF;

  v_next := coalesce(v_credential."version", 0) + 1;
  v_secret_id := vault.create_secret(
    p_bundle::text,
    format('zuri:NOTION_OAUTH_TOKEN:%s:v%s:%s', p_connection_id, v_next, gen_random_uuid()),
    format('FR-273 Notion credential: tenant=%s business=%s connection=%s version=%s', p_tenant_id, p_business_id, p_connection_id, v_next)
  );
  v_ref := 'supabase-vault:' || v_secret_id::text;

  IF v_credential."id" IS NULL THEN
    INSERT INTO public."IntegrationCredential"
      ("id", "connectionId", "secretRef", "secretStore", "secretKind", "status", "displayHint", "expiresAt", "createdAt", "updatedAt", "version")
    VALUES
      (gen_random_uuid()::text, p_connection_id, v_ref, 'SUPABASE_VAULT', 'NOTION_OAUTH_TOKEN', 'PENDING_VALIDATION', NULL, p_expires_at, now(), now(), 1)
    RETURNING * INTO v_credential;
  ELSE
    FOR v_pending IN
      SELECT v."id" FROM public."IntegrationCredentialVersion" v
      WHERE v."credentialId" = v_credential."id" AND v."status" = 'PENDING_VALIDATION'
    LOOP
      UPDATE public."IntegrationCredentialVersion"
      SET "status" = 'REJECTED', "revokedAt" = now(), "reason" = 'SUPERSEDED_BY_NEWER_WRITE'
      WHERE "id" = v_pending."id";
      PERFORM zuri_core.channel_secret_purge_version(v_pending."id", p_connection_id);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public."IntegrationCredentialVersion" v WHERE v."credentialId" = v_credential."id") THEN
      INSERT INTO public."IntegrationCredentialVersion"
        ("id", "credentialId", "tenantId", "businessId", "versionNumber", "secretRef", "secretStore", "status", "createdVia", "createdAt")
      VALUES
        (gen_random_uuid()::text, v_credential."id", p_tenant_id, p_business_id, v_credential."version", v_credential."secretRef", v_credential."secretStore",
         CASE WHEN v_credential."status" IN ('ACTIVE', 'ROTATING') THEN 'ACTIVE' ELSE 'REVOKED' END, 'BACKFILL', v_credential."createdAt");
    END IF;

    IF v_credential."status" IN ('ACTIVE', 'ROTATING') THEN
      UPDATE public."IntegrationCredential"
      SET "status" = 'ROTATING', "version" = v_next, "updatedAt" = now()
      WHERE "id" = v_credential."id";
    ELSE
      UPDATE public."IntegrationCredential"
      SET "secretRef" = v_ref, "secretStore" = 'SUPABASE_VAULT', "secretKind" = 'NOTION_OAUTH_TOKEN',
          "status" = 'PENDING_VALIDATION', "displayHint" = NULL, "expiresAt" = p_expires_at,
          "revokedAt" = NULL, "revokeReason" = NULL, "version" = v_next, "updatedAt" = now()
      WHERE "id" = v_credential."id";
    END IF;
  END IF;

  INSERT INTO public."IntegrationCredentialVersion"
    ("id", "credentialId", "tenantId", "businessId", "versionNumber", "secretRef", "secretStore", "status", "displayHint", "createdById", "createdVia", "createdAt")
  VALUES
    (gen_random_uuid()::text, v_credential."id", p_tenant_id, p_business_id, v_next, v_ref, 'SUPABASE_VAULT', 'PENDING_VALIDATION', NULL, p_actor_person_id, p_created_via, now());

  secret_ref := v_ref;
  version_number := v_next;
  RETURN NEXT;
END
$function$;

CREATE OR REPLACE FUNCTION zuri_core.notion_secret_resolve(
  p_secret_ref text,
  p_tenant_id text,
  p_business_id text,
  p_connection_id text
)
RETURNS TABLE (secret_material text, version text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_secret_id uuid;
  v_version_number integer;
  v_expiry timestamptz;
BEGIN
  IF p_secret_ref IS NULL
    OR p_secret_ref !~* '^supabase-vault:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN; END IF;
  v_secret_id := substring(p_secret_ref FROM 16)::uuid;

  SELECT v."versionNumber", cr."expiresAt"
    INTO v_version_number, v_expiry
  FROM public."IntegrationCredential" cr
  JOIN public."IntegrationCredentialVersion" v
    ON v."credentialId" = cr."id" AND v."secretRef" = cr."secretRef" AND v."status" = 'ACTIVE'
  JOIN public."IntegrationConnection" c ON c."id" = cr."connectionId"
  WHERE cr."secretRef" = p_secret_ref
    AND cr."secretStore" = 'SUPABASE_VAULT'
    AND cr."secretKind" = 'NOTION_OAUTH_TOKEN'
    AND cr."status" IN ('ACTIVE', 'ROTATING')
    AND (cr."expiresAt" IS NULL OR cr."expiresAt" > now())
    AND c."id" = p_connection_id
    AND c."tenantId" = p_tenant_id
    AND c."businessId" = p_business_id
    AND c."status" = 'ACTIVE'
    AND c."authorizationType" = 'SECRET_MANAGER';
  IF NOT FOUND THEN RETURN; END IF;

  SELECT d.decrypted_secret INTO secret_material
  FROM vault.decrypted_secrets d
  WHERE d.id = v_secret_id
    AND d.name LIKE 'zuri:NOTION_OAUTH_TOKEN:' || p_connection_id || ':v%';
  IF secret_material IS NULL THEN RETURN; END IF;

  version := format('credential-v%s', v_version_number);
  expires_at := least(coalesce(v_expiry, now() + interval '5 minutes'), now() + interval '5 minutes');
  RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION zuri_core.notion_secret_write(text, text, text, jsonb, timestamptz, text, text) FROM public;
REVOKE ALL ON FUNCTION zuri_core.notion_secret_resolve(text, text, text, text) FROM public;
DO $revoke_api_roles$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'zuri_app_runtime', 'zuri_web_login'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION zuri_core.notion_secret_write(text, text, text, jsonb, timestamptz, text, text) FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON FUNCTION zuri_core.notion_secret_resolve(text, text, text, text) FROM %I', v_role);
    END IF;
  END LOOP;
END
$revoke_api_roles$;
GRANT EXECUTE ON FUNCTION zuri_core.notion_secret_write(text, text, text, jsonb, timestamptz, text, text) TO zuri_channel_vault_writer;
GRANT EXECUTE ON FUNCTION zuri_core.notion_secret_resolve(text, text, text, text) TO zuri_channel_vault_reader;
COMMENT ON FUNCTION zuri_core.notion_secret_write(text, text, text, jsonb, timestamptz, text, text) IS
  'FR-273 — write a validated NOTION_OAUTH_TOKEN bundle through Supabase Vault; only zuri_channel_vault_writer may execute it.';
COMMENT ON FUNCTION zuri_core.notion_secret_resolve(text, text, text, text) IS
  'FR-273 — resolve an ACTIVE NOTION_OAUTH_TOKEN for its exact Tenant, Business and connection; only zuri_channel_vault_reader may execute it.';

COMMIT;
