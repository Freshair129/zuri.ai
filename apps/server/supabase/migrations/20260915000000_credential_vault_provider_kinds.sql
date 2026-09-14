-- @req FR-NEW — generalise the Supabase Vault credential store beyond LINE_CHANNEL:
-- new SECURITY DEFINER functions write and resolve OAUTH_CLIENT and
-- MODEL_PROVIDER_KEY bundles, reusing the same two NOLOGIN roles and the same
-- purge helper as the LINE channel functions.
-- @spec ADR-089 §4.8 phase 7; SDD-097; SEC-030
-- @tested tests/unit/integration/credential-vault-provider-kinds-migration.test.js,
--   tests/unit/integration/supabase-vault-secret-store.test.js,
--   tests/integration/credential-vault-provider-kinds-lifecycle.test.js
--
-- Design choice, stated once here rather than argued at every call site:
-- zuri_core.channel_secret_write/activate/revoke/resolve
-- (20260914140200_channel_secret_vault_functions.sql) are NOT modified by this
-- migration, and that file is not edited. It is already applied in production
-- and channel_secret_resolve is on the path every live LINE model/channel
-- credential resolves through today; channel_secret_resolve's `p."code" =
-- 'LINE_OA'` and mandatory LINE destination are load-bearing for that traffic,
-- not incidental, so this migration does not touch that function's body at
-- all. A new, separate function pair for the two new kinds is strictly safer
-- than widening a live function, and reads no worse:
--
--   * zuri_core.provider_secret_write   — OAUTH_CLIENT / MODEL_PROVIDER_KEY bundle
--     validation and version insert. Refuses LINE_CHANNEL and anything else with
--     CHANNEL_SECRET_KIND_UNSUPPORTED — it is not a second way to write a LINE
--     channel credential. It also refuses, with CREDENTIAL_KIND_MISMATCH before
--     any secret reaches the vault, a write whose kind disagrees with a
--     connectionId's existing credential (live or dead): without this a
--     connectionId already holding an ACTIVE credential of one kind could have
--     its row silently rotated to a different kind's material while its
--     secretKind column, and every reader that trusts it, stayed unaware —
--     exactly the class of bug behind this repo's LINE outages (.brain/rca/).
--     channel_secret_write has the same shape of gap in the opposite direction
--     (writing LINE_CHANNEL over a connectionId already holding a live
--     OAUTH_CLIENT/MODEL_PROVIDER_KEY row would rotate it without checking
--     secretKind either) and is not guarded here because this migration does
--     not touch that function's body at all, per the design choice above; the
--     application-level rule until that gap is closed is that a connection's
--     kind is fixed for its life — nothing today writes a second kind at a
--     connectionId already provisioned for LINE_OA.
--   * zuri_core.provider_secret_resolve — resolves an ACTIVE version filtered by
--     `cr."secretKind" = p_kind` (the cross-kind refusal: a MODEL_PROVIDER_KEY
--     reference can never come back for an OAUTH_CLIENT request or vice versa,
--     and neither can ever come back as LINE_CHANNEL, which this function
--     refuses outright). It has no destination or provider-code concept: no
--     fixed provider list exists yet for FlowAccount-shaped OAuth clients or for
--     model providers, so none is invented here — the connection's Tenant,
--     Business, id, ACTIVE status and SECRET_MANAGER authorization type are the
--     whole scope check, exactly as they are for channel_secret_resolve before
--     its LINE-specific destination/provider check is applied.
--
-- zuri_core.channel_secret_activate and zuri_core.channel_secret_revoke ARE
-- reused unchanged for the two new kinds (called by the application exactly as
-- they are for LINE_CHANNEL): neither function reads secretKind anywhere in its
-- body, so nothing about them is LINE-specific — they operate purely on
-- IntegrationCredential/IntegrationCredentialVersion rows whatever kind wrote
-- them, and their existing "re-prove Tenant/Business from rows" guarantees hold
-- for every kind identically. Building parallel activate/revoke functions would
-- duplicate exactly the code this migration is not changing.
--
-- NOT APPLIED by the change that writes it. Applying is an owner-instructed
-- operator step (ADR-057), after 20260914140200_channel_secret_vault_functions.sql.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:integration:channel-secret-vault:v1'));

do $precondition_guard$
begin
  if to_regnamespace('zuri_core') is null
    or to_regclass('public."IntegrationConnection"') is null
    or to_regclass('public."IntegrationCredential"') is null
    or to_regclass('public."IntegrationCredentialVersion"') is null
    or to_regprocedure('zuri_core.channel_secret_purge_version(text, text)') is null
    or not exists (select 1 from pg_roles where rolname = 'zuri_channel_vault_writer')
    or not exists (select 1 from pg_roles where rolname = 'zuri_channel_vault_reader') then
    raise exception 'CHANNEL_SECRET_VAULT_PRECONDITION_FAILED: 20260914140200_channel_secret_vault_functions.sql must be applied first';
  end if;
end
$precondition_guard$;

do $vault_owner_guard$
begin
  if to_regclass('vault.secrets') is null
    or to_regclass('vault.decrypted_secrets') is null
    or not has_table_privilege(current_user, 'vault.decrypted_secrets', 'select')
    or not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vault' and p.proname = 'create_secret'
    ) then
    raise exception 'CHANNEL_SECRET_VAULT_PRECONDITION_FAILED: migration executor must read vault.decrypted_secrets and call vault.create_secret';
  end if;
end
$vault_owner_guard$;

create or replace function zuri_core.provider_secret_write(
  p_connection_id text,
  p_tenant_id text,
  p_business_id text,
  p_kind text,
  p_bundle jsonb,
  p_expires_at timestamptz,
  p_actor_person_id text,
  p_created_via text
)
returns table (secret_ref text, version_number integer)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_connection_id text;
  v_credential public."IntegrationCredential"%rowtype;
  v_next integer;
  v_secret_id uuid;
  v_ref text;
  v_hint text;
  v_pending record;
begin
  if p_kind not in ('OAUTH_CLIENT', 'MODEL_PROVIDER_KEY') then
    raise exception 'CHANNEL_SECRET_KIND_UNSUPPORTED';
  end if;
  if p_created_via is null or p_created_via not in ('BROWSER_MFA', 'OPERATOR_CLI') then
    raise exception 'CHANNEL_SECRET_BUNDLE_INVALID';
  end if;
  if p_bundle is null or jsonb_typeof(p_bundle) <> 'object' then
    raise exception 'CHANNEL_SECRET_BUNDLE_INVALID';
  end if;

  if p_kind = 'OAUTH_CLIENT' then
    -- PostgreSQL caps a regex repetition bound at 255, so length is checked apart.
    if coalesce(p_bundle->>'clientId', '') !~ '^[!-~]+$'
      or length(p_bundle->>'clientId') not between 1 and 200
      or coalesce(p_bundle->>'clientSecret', '') !~ '^[!-~]+$'
      or length(p_bundle->>'clientSecret') not between 16 and 4096
      or exists (
        select 1 from jsonb_object_keys(p_bundle) k
        where k not in ('clientId', 'clientSecret')
      ) then
      raise exception 'CHANNEL_SECRET_BUNDLE_INVALID';
    end if;
    v_hint := right(p_bundle->>'clientId', 4);
  else
    if coalesce(p_bundle->>'apiKey', '') !~ '^[!-~]+$'
      or length(p_bundle->>'apiKey') not between 20 and 4096
      or exists (
        select 1 from jsonb_object_keys(p_bundle) k
        where k not in ('apiKey')
      ) then
      raise exception 'CHANNEL_SECRET_BUNDLE_INVALID';
    end if;
    v_hint := null;
  end if;

  select c."id" into v_connection_id
  from public."IntegrationConnection" c
  where c."id" = p_connection_id
    and c."tenantId" = p_tenant_id
    and c."businessId" = p_business_id
    and c."authorizationType" = 'SECRET_MANAGER'
  for update;
  if v_connection_id is null then
    raise exception 'CHANNEL_SECRET_SCOPE_MISMATCH';
  end if;

  select * into v_credential
  from public."IntegrationCredential" cr
  where cr."connectionId" = p_connection_id
  for update;

  -- A connection's kind never changes underneath its credential by a plain
  -- write, live or dead: refused before any secret reaches the vault, in both
  -- the "rotate" and "replace a dead row" branches below. Without this, a
  -- connectionId already holding an ACTIVE LINE_CHANNEL (or the other new
  -- kind) credential could have its live row silently rotated to a different
  -- kind's material while its secretKind column and every reader that trusts
  -- it stayed unaware.
  if v_credential."id" is not null and v_credential."secretKind" is distinct from p_kind then
    raise exception 'CREDENTIAL_KIND_MISMATCH';
  end if;

  v_next := coalesce(v_credential."version", 0) + 1;
  v_secret_id := vault.create_secret(
    p_bundle::text,
    format('zuri:%s:%s:v%s:%s', p_kind, p_connection_id, v_next, gen_random_uuid()),
    format('FR-NEW credential: tenant=%s business=%s connection=%s version=%s', p_tenant_id, p_business_id, p_connection_id, v_next)
  );
  v_ref := 'supabase-vault:' || v_secret_id::text;

  if v_credential."id" is null then
    insert into public."IntegrationCredential"
      ("id", "connectionId", "secretRef", "secretStore", "secretKind", "status", "displayHint", "expiresAt",
       "createdAt", "updatedAt", "version")
    values
      (gen_random_uuid()::text, p_connection_id, v_ref, 'SUPABASE_VAULT', p_kind, 'PENDING_VALIDATION', v_hint,
       p_expires_at, now(), now(), 1)
    returning * into v_credential;
  else
    -- A newer write supersedes a pending version that never validated.
    for v_pending in
      select v."id" from public."IntegrationCredentialVersion" v
      where v."credentialId" = v_credential."id" and v."status" = 'PENDING_VALIDATION'
    loop
      update public."IntegrationCredentialVersion"
      set "status" = 'REJECTED', "revokedAt" = now(), "reason" = 'SUPERSEDED_BY_NEWER_WRITE'
      where "id" = v_pending."id";
      perform zuri_core.channel_secret_purge_version(v_pending."id", p_connection_id);
    end loop;

    -- A credential written before version history existed (the mount path).
    if not exists (
      select 1 from public."IntegrationCredentialVersion" v where v."credentialId" = v_credential."id"
    ) then
      insert into public."IntegrationCredentialVersion"
        ("id", "credentialId", "tenantId", "businessId", "versionNumber", "secretRef", "secretStore", "status",
         "createdVia", "createdAt")
      values
        (gen_random_uuid()::text, v_credential."id", p_tenant_id, p_business_id, v_credential."version",
         v_credential."secretRef", v_credential."secretStore",
         case when v_credential."status" in ('ACTIVE', 'ROTATING') then 'ACTIVE' else 'REVOKED' end,
         'BACKFILL', v_credential."createdAt");
    end if;

    if v_credential."status" in ('ACTIVE', 'ROTATING') then
      update public."IntegrationCredential"
      set "status" = 'ROTATING', "version" = v_next, "updatedAt" = now()
      where "id" = v_credential."id";
    else
      update public."IntegrationCredential"
      set "secretRef" = v_ref, "secretStore" = 'SUPABASE_VAULT', "secretKind" = p_kind,
          "status" = 'PENDING_VALIDATION', "displayHint" = v_hint, "expiresAt" = p_expires_at,
          "revokedAt" = null, "revokeReason" = null, "version" = v_next, "updatedAt" = now()
      where "id" = v_credential."id";
    end if;
  end if;

  insert into public."IntegrationCredentialVersion"
    ("id", "credentialId", "tenantId", "businessId", "versionNumber", "secretRef", "secretStore", "status",
     "displayHint", "createdById", "createdVia", "createdAt")
  values
    (gen_random_uuid()::text, v_credential."id", p_tenant_id, p_business_id, v_next, v_ref, 'SUPABASE_VAULT',
     'PENDING_VALIDATION', v_hint, p_actor_person_id, p_created_via, now());

  secret_ref := v_ref;
  version_number := v_next;
  return next;
end
$function$;

create or replace function zuri_core.provider_secret_resolve(
  p_secret_ref text,
  p_tenant_id text,
  p_business_id text,
  p_connection_id text,
  p_kind text
)
returns table (secret_material text, version text, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_secret_id uuid;
  v_version_number integer;
  v_expiry timestamptz;
begin
  if p_kind not in ('OAUTH_CLIENT', 'MODEL_PROVIDER_KEY') then
    return;
  end if;
  if p_secret_ref is null
    or p_secret_ref !~* '^supabase-vault:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;
  v_secret_id := substring(p_secret_ref from 16)::uuid;

  select v."versionNumber", cr."expiresAt"
    into v_version_number, v_expiry
  from public."IntegrationCredential" cr
  join public."IntegrationCredentialVersion" v
    on v."credentialId" = cr."id" and v."secretRef" = cr."secretRef" and v."status" = 'ACTIVE'
  join public."IntegrationConnection" c on c."id" = cr."connectionId"
  where cr."secretRef" = p_secret_ref
    and cr."secretStore" = 'SUPABASE_VAULT'
    and cr."secretKind" = p_kind
    and cr."status" in ('ACTIVE', 'ROTATING')
    and (cr."expiresAt" is null or cr."expiresAt" > now())
    and c."id" = p_connection_id
    and c."tenantId" = p_tenant_id
    and c."businessId" = p_business_id
    and c."status" = 'ACTIVE'
    and c."authorizationType" = 'SECRET_MANAGER';
  if not found then
    return;
  end if;

  select d.decrypted_secret into secret_material
  from vault.decrypted_secrets d
  where d.id = v_secret_id
    and d.name like 'zuri:%:' || p_connection_id || ':v%';
  if secret_material is null then
    return;
  end if;

  version := format('credential-v%s', v_version_number);
  -- Never cached past five minutes, whatever the metadata says (the SecretManagerPort bound).
  expires_at := least(coalesce(v_expiry, now() + interval '5 minutes'), now() + interval '5 minutes');
  return next;
end
$function$;

revoke all on function zuri_core.provider_secret_write(text, text, text, text, jsonb, timestamptz, text, text) from public;
revoke all on function zuri_core.provider_secret_resolve(text, text, text, text, text) from public;

do $revoke_api_roles$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'zuri_app_runtime', 'zuri_web_login'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function zuri_core.provider_secret_write(text, text, text, text, jsonb, timestamptz, text, text) from %I', v_role);
      execute format('revoke all on function zuri_core.provider_secret_resolve(text, text, text, text, text) from %I', v_role);
    end if;
  end loop;
end
$revoke_api_roles$;

grant execute on function zuri_core.provider_secret_write(text, text, text, text, jsonb, timestamptz, text, text) to zuri_channel_vault_writer;
grant execute on function zuri_core.provider_secret_resolve(text, text, text, text, text) to zuri_channel_vault_reader;

comment on function zuri_core.provider_secret_write(text, text, text, text, jsonb, timestamptz, text, text) is
  'FR-NEW — write an OAUTH_CLIENT or MODEL_PROVIDER_KEY credential version PENDING_VALIDATION into Supabase Vault; refuses LINE_CHANNEL and anything else, and refuses a connectionId already holding a credential of a different kind (CREDENTIAL_KIND_MISMATCH) before any secret reaches the vault. zuri_channel_vault_writer only.';
comment on function zuri_core.provider_secret_resolve(text, text, text, text, text) is
  'FR-NEW — resolve an ACTIVE OAUTH_CLIENT or MODEL_PROVIDER_KEY version for its exact Tenant, Business and connection; no row for every refusal, and never for LINE_CHANNEL. zuri_channel_vault_reader only.';

commit;
