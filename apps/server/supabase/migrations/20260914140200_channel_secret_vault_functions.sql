-- @req FR-223 — the Supabase Vault store of the credential vault: SECURITY DEFINER
-- write, activate, revoke and resolve functions over the public Prisma tables,
-- executable only by two NOLOGIN roles (design migration 3).
-- @spec ADR-089 D1, D2, D5; SDD-097; SEC-030; ADR-057
-- @tested tests/unit/integration/credential-vault-migrations.test.js, tests/integration/credential-vault.postgres.test.js
--
-- The security story of the hosted store is exactly this file (ADR-089
-- Consequences): Supabase Vault encrypts with a per-project root key that never
-- enters the database, and its boundary is SQL privilege on vault.secrets and
-- vault.decrypted_secrets. So:
--
--   * No application role is granted anything on the vault schema. Only these
--     functions touch it, and they run as their owner (the migration executor).
--   * Each function pins search_path to pg_catalog, pg_temp and names every object
--     by schema, so a temporary object cannot shadow what it reads.
--   * Every function re-proves Tenant, Business and connection from the rows —
--     resolve also the LINE destination and provider — and never trusts an argument
--     alone. A foreign connection id raises CHANNEL_SECRET_SCOPE_MISMATCH from the
--     database (ADR-089 proof 2); resolve answers no row for every refusal.
--   * Execute is granted to zuri_channel_vault_writer (write, activate, revoke) and
--     zuri_channel_vault_reader (resolve) only, both NOLOGIN, NOINHERIT, NOBYPASSRLS.
--     The application enters them with `set local role` for one statement.
--   * A vault secret is named zuri:<kind>:<connection>:v<n>:<random>; purge and
--     resolve also require that name, so a reference pointing at another
--     connection's vault row does not open or delete it.
--   * Nothing raised here quotes a parameter: messages are fixed codes.
--
-- Lifecycle (ADR-089 D5; the envelope store implements the same in the app):
--   write     new version PENDING_VALIDATION; if the credential resolves today it
--             becomes ROTATING and keeps its reference, otherwise the new reference
--             is set; an older pending version is REJECTED and purged.
--   activate  PENDING_VALIDATION -> ACTIVE after live validation; the previous
--             ACTIVE version becomes SUPERSEDED and its vault row is purged.
--   revoke    with a version number: reject that pending version (the credential
--             returns to ACTIVE, or is REVOKED if it had nothing else). Without:
--             the credential is REVOKED and every version's material purged.
--   A purge that fails leaves the version REVOKED, REJECTED or SUPERSEDED — not
--   PURGED — and is counted in purge_failed_count for a reconciler.
--
-- The Phase-1 model-credential resolver (zuri_core.resolve_phase1_line_secret) is
-- not touched (SDD-097).
--
-- NOT APPLIED by the change that writes it. Applying is an owner-instructed operator
-- step (ADR-057), after 20260914140000_integration_credential_lifecycle.sql, with
-- the same Vault precondition as 20260818050000.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:integration:channel-secret-vault:v1'));

do $precondition_guard$
begin
  if to_regnamespace('zuri_core') is null
    or to_regclass('public."IntegrationConnection"') is null
    or to_regclass('public."IntegrationProvider"') is null
    or to_regclass('public."IntegrationCredential"') is null
    or to_regclass('public."IntegrationCredentialVersion"') is null then
    raise exception 'CHANNEL_SECRET_VAULT_PRECONDITION_FAILED: zuri_core schema or credential lifecycle tables are missing';
  end if;
end
$precondition_guard$;

do $vault_owner_guard$
begin
  if to_regclass('vault.secrets') is null
    or to_regclass('vault.decrypted_secrets') is null
    or not has_table_privilege(current_user, 'vault.decrypted_secrets', 'select')
    or not has_table_privilege(current_user, 'vault.secrets', 'delete')
    or not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'vault' and p.proname = 'create_secret'
    ) then
    raise exception 'CHANNEL_SECRET_VAULT_PRECONDITION_FAILED: migration executor must read vault.decrypted_secrets, delete vault.secrets and call vault.create_secret';
  end if;
end
$vault_owner_guard$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_channel_vault_writer') then
    create role zuri_channel_vault_writer noinherit nobypassrls nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'zuri_channel_vault_reader') then
    create role zuri_channel_vault_reader noinherit nobypassrls nologin;
  end if;
end
$roles$;

alter role zuri_channel_vault_writer noinherit nobypassrls nologin;
alter role zuri_channel_vault_reader noinherit nobypassrls nologin;

-- The application may enter the roles: today it connects as postgres; the schema is
-- built for zuri_web_login. Neither role is granted to a Data API role.
--
-- Membership is granted WITH INHERIT FALSE: NOINHERIT on the vault roles governs only
-- what *they* inherit, while a login that is a plain member would inherit their
-- EXECUTE rights and call the functions without ever entering a role. PostgreSQL 16
-- made inheritance a property of the grant; on an older server the grant cannot say
-- it, so the migration grants plainly and reports that the login inherits.
do $membership$
declare
  v_login text;
begin
  foreach v_login in array array['postgres', 'zuri_web_login'] loop
    if exists (select 1 from pg_roles where rolname = v_login) then
      if current_setting('server_version_num')::int >= 160000 then
        execute format('grant zuri_channel_vault_writer, zuri_channel_vault_reader to %I with inherit false, set true', v_login);
      else
        execute format('grant zuri_channel_vault_writer, zuri_channel_vault_reader to %I', v_login);
        raise notice 'CHANNEL_SECRET_VAULT_MEMBERSHIP_INHERITS: server older than PostgreSQL 16; % inherits vault function rights', v_login;
      end if;
    end if;
  end loop;
end
$membership$;

-- Private helper: delete one version's vault row and mark it PURGED. Returns false,
-- leaving the version as it was, when the row is not this connection's or the
-- delete fails. Executable by no role; called only by the functions below.
create or replace function zuri_core.channel_secret_purge_version(p_version_id text, p_connection_id text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_ref text;
  v_secret_id uuid;
begin
  select v."secretRef" into v_ref
  from public."IntegrationCredentialVersion" v
  where v."id" = p_version_id and v."secretStore" = 'SUPABASE_VAULT';
  if v_ref is null
    or v_ref !~* '^supabase-vault:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_secret_id := substring(v_ref from 16)::uuid;
  begin
    delete from vault.secrets s
    where s.id = v_secret_id
      and s.name like 'zuri:%:' || p_connection_id || ':v%';
    update public."IntegrationCredentialVersion"
    set "status" = 'PURGED', "purgedAt" = now()
    where "id" = p_version_id;
    return true;
  exception when others then
    return false;
  end;
end
$function$;

create or replace function zuri_core.channel_secret_write(
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
  if p_kind is distinct from 'LINE_CHANNEL' then
    raise exception 'CHANNEL_SECRET_KIND_UNSUPPORTED';
  end if;
  if p_created_via is null or p_created_via not in ('BROWSER_MFA', 'OPERATOR_CLI') then
    raise exception 'CHANNEL_SECRET_BUNDLE_INVALID';
  end if;
  if p_bundle is null or jsonb_typeof(p_bundle) <> 'object'
    or coalesce(p_bundle->>'channelId', '') !~ '^[0-9]{6,20}$'
    or coalesce(p_bundle->>'channelSecret', '') !~ '^[0-9a-f]{32}$'
    -- PostgreSQL caps a regex repetition bound at 255, so the length is checked apart.
    or (p_bundle ? 'channelAccessToken'
      and (coalesce(p_bundle->>'channelAccessToken', '') !~ '^[A-Za-z0-9+/=_-]+$'
        or length(p_bundle->>'channelAccessToken') not between 40 and 4096))
    or exists (
      select 1 from jsonb_object_keys(p_bundle) k
      where k not in ('channelId', 'channelSecret', 'channelAccessToken')
    ) then
    raise exception 'CHANNEL_SECRET_BUNDLE_INVALID';
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

  v_next := coalesce(v_credential."version", 0) + 1;
  v_hint := right(p_bundle->>'channelId', 4);
  v_secret_id := vault.create_secret(
    p_bundle::text,
    format('zuri:%s:%s:v%s:%s', p_kind, p_connection_id, v_next, gen_random_uuid()),
    format('FR-223 credential: tenant=%s business=%s connection=%s version=%s', p_tenant_id, p_business_id, p_connection_id, v_next)
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

create or replace function zuri_core.channel_secret_activate(
  p_connection_id text,
  p_tenant_id text,
  p_business_id text,
  p_version_number integer,
  p_validation_code text
)
returns table (secret_ref text, version_number integer, superseded_count integer, purge_failed_count integer)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_connection_id text;
  v_credential public."IntegrationCredential"%rowtype;
  v_pending public."IntegrationCredentialVersion"%rowtype;
  v_previous record;
  v_superseded integer := 0;
  v_failed integer := 0;
begin
  if p_validation_code is null or p_validation_code !~ '^[A-Z0-9_:]{1,80}$' then
    raise exception 'CREDENTIAL_VALIDATION_CODE_INVALID';
  end if;

  select c."id" into v_connection_id
  from public."IntegrationConnection" c
  where c."id" = p_connection_id and c."tenantId" = p_tenant_id and c."businessId" = p_business_id
    and c."authorizationType" = 'SECRET_MANAGER'
  for update;
  if v_connection_id is null then
    raise exception 'CHANNEL_SECRET_SCOPE_MISMATCH';
  end if;

  select * into v_credential from public."IntegrationCredential" cr
  where cr."connectionId" = p_connection_id for update;
  if v_credential."id" is null then
    raise exception 'CREDENTIAL_NOT_FOUND';
  end if;

  select * into v_pending from public."IntegrationCredentialVersion" v
  where v."credentialId" = v_credential."id" and v."versionNumber" = p_version_number
    and v."status" = 'PENDING_VALIDATION';
  if v_pending."id" is null or v_credential."version" <> p_version_number then
    raise exception 'CREDENTIAL_VERSION_CONFLICT';
  end if;

  for v_previous in
    select v."id", v."secretStore" from public."IntegrationCredentialVersion" v
    where v."credentialId" = v_credential."id" and v."status" = 'ACTIVE' and v."id" <> v_pending."id"
  loop
    v_superseded := v_superseded + 1;
    update public."IntegrationCredentialVersion"
    set "status" = 'SUPERSEDED', "supersededAt" = now(),
        "reason" = case when v_previous."secretStore" = 'SUPABASE_VAULT' then "reason" else 'MATERIAL_OUTSIDE_THIS_STORE' end
    where "id" = v_previous."id";
  end loop;

  update public."IntegrationCredential"
  set "secretRef" = v_pending."secretRef", "secretStore" = v_pending."secretStore", "status" = 'ACTIVE',
      "displayHint" = v_pending."displayHint", "lastValidatedAt" = now(), "lastValidationCode" = p_validation_code,
      "rotatedAt" = case when v_superseded > 0 then now() else "rotatedAt" end,
      "revokedAt" = null, "revokeReason" = null, "updatedAt" = now()
  where "id" = v_credential."id";

  update public."IntegrationCredentialVersion"
  set "status" = 'ACTIVE', "activatedAt" = now()
  where "id" = v_pending."id";

  for v_previous in
    select v."id" from public."IntegrationCredentialVersion" v
    where v."credentialId" = v_credential."id" and v."status" = 'SUPERSEDED' and v."secretStore" = 'SUPABASE_VAULT'
      and v."purgedAt" is null
  loop
    if not zuri_core.channel_secret_purge_version(v_previous."id", p_connection_id) then
      v_failed := v_failed + 1;
    end if;
  end loop;

  secret_ref := v_pending."secretRef";
  version_number := p_version_number;
  superseded_count := v_superseded;
  purge_failed_count := v_failed;
  return next;
end
$function$;

create or replace function zuri_core.channel_secret_revoke(
  p_connection_id text,
  p_tenant_id text,
  p_business_id text,
  p_reason text,
  p_version_number integer
)
returns table (credential_status text, revoked_count integer, purged_count integer, purge_failed_count integer)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_connection_id text;
  v_credential public."IntegrationCredential"%rowtype;
  v_pending public."IntegrationCredentialVersion"%rowtype;
  v_version record;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'REVOKED'), 200);
  v_status text;
  v_revoked integer := 0;
  v_purged integer := 0;
  v_failed integer := 0;
begin
  select c."id" into v_connection_id
  from public."IntegrationConnection" c
  where c."id" = p_connection_id and c."tenantId" = p_tenant_id and c."businessId" = p_business_id
    and c."authorizationType" = 'SECRET_MANAGER'
  for update;
  if v_connection_id is null then
    raise exception 'CHANNEL_SECRET_SCOPE_MISMATCH';
  end if;

  select * into v_credential from public."IntegrationCredential" cr
  where cr."connectionId" = p_connection_id for update;
  if v_credential."id" is null then
    raise exception 'CREDENTIAL_NOT_FOUND';
  end if;
  v_status := v_credential."status";

  if p_version_number is not null then
    select * into v_pending from public."IntegrationCredentialVersion" v
    where v."credentialId" = v_credential."id" and v."versionNumber" = p_version_number
      and v."status" = 'PENDING_VALIDATION';
    if v_pending."id" is null then
      raise exception 'CREDENTIAL_VERSION_CONFLICT';
    end if;
    update public."IntegrationCredentialVersion"
    set "status" = 'REJECTED', "revokedAt" = now(), "reason" = v_reason
    where "id" = v_pending."id";
    v_revoked := 1;
    if v_credential."status" = 'ROTATING' then
      v_status := 'ACTIVE';
      update public."IntegrationCredential" set "status" = 'ACTIVE', "updatedAt" = now()
      where "id" = v_credential."id";
    elsif v_credential."status" = 'PENDING_VALIDATION' and v_credential."secretRef" = v_pending."secretRef" then
      v_status := 'REVOKED';
      update public."IntegrationCredential"
      set "status" = 'REVOKED', "revokedAt" = now(), "revokeReason" = v_reason,
          "version" = "version" + 1, "updatedAt" = now()
      where "id" = v_credential."id";
    end if;
    if v_pending."secretStore" = 'SUPABASE_VAULT' then
      if zuri_core.channel_secret_purge_version(v_pending."id", p_connection_id) then
        v_purged := 1;
      else
        v_failed := 1;
      end if;
    end if;
  else
    if v_credential."status" <> 'REVOKED' then
      update public."IntegrationCredential"
      set "status" = 'REVOKED', "revokedAt" = now(), "revokeReason" = v_reason,
          "version" = "version" + 1, "updatedAt" = now()
      where "id" = v_credential."id";
    end if;
    v_status := 'REVOKED';
    for v_version in
      select v."id", v."status", v."secretStore" from public."IntegrationCredentialVersion" v
      where v."credentialId" = v_credential."id"
        and v."status" in ('PENDING_VALIDATION', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'REVOKED')
    loop
      v_revoked := v_revoked + 1;
      if v_version."status" <> 'REVOKED' then
        update public."IntegrationCredentialVersion"
        set "status" = 'REVOKED', "revokedAt" = now(), "reason" = v_reason
        where "id" = v_version."id";
      end if;
      if v_version."secretStore" = 'SUPABASE_VAULT' then
        if zuri_core.channel_secret_purge_version(v_version."id", p_connection_id) then
          v_purged := v_purged + 1;
        else
          v_failed := v_failed + 1;
        end if;
      end if;
    end loop;
  end if;

  credential_status := v_status;
  revoked_count := v_revoked;
  purged_count := v_purged;
  purge_failed_count := v_failed;
  return next;
end
$function$;

create or replace function zuri_core.channel_secret_resolve(
  p_secret_ref text,
  p_tenant_id text,
  p_business_id text,
  p_connection_id text,
  p_destination text
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
  if p_secret_ref is null
    or p_secret_ref !~* '^supabase-vault:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_destination is null or p_destination = '' then
    return;
  end if;
  v_secret_id := substring(p_secret_ref from 16)::uuid;

  select v."versionNumber", cr."expiresAt"
    into v_version_number, v_expiry
  from public."IntegrationCredential" cr
  join public."IntegrationCredentialVersion" v
    on v."credentialId" = cr."id" and v."secretRef" = cr."secretRef" and v."status" = 'ACTIVE'
  join public."IntegrationConnection" c on c."id" = cr."connectionId"
  join public."IntegrationProvider" p on p."id" = c."providerId"
  where cr."secretRef" = p_secret_ref
    and cr."secretStore" = 'SUPABASE_VAULT'
    and cr."status" in ('ACTIVE', 'ROTATING')
    and (cr."expiresAt" is null or cr."expiresAt" > now())
    and c."id" = p_connection_id
    and c."tenantId" = p_tenant_id
    and c."businessId" = p_business_id
    and c."externalAccountId" = p_destination
    and c."status" = 'ACTIVE'
    and c."authorizationType" = 'SECRET_MANAGER'
    and p."code" = 'LINE_OA';
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

revoke all on function zuri_core.channel_secret_purge_version(text, text) from public;
revoke all on function zuri_core.channel_secret_write(text, text, text, text, jsonb, timestamptz, text, text) from public;
revoke all on function zuri_core.channel_secret_activate(text, text, text, integer, text) from public;
revoke all on function zuri_core.channel_secret_revoke(text, text, text, text, integer) from public;
revoke all on function zuri_core.channel_secret_resolve(text, text, text, text, text) from public;

do $revoke_api_roles$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'zuri_app_runtime', 'zuri_web_login'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      execute format('revoke all on function zuri_core.channel_secret_purge_version(text, text) from %I', v_role);
      execute format('revoke all on function zuri_core.channel_secret_write(text, text, text, text, jsonb, timestamptz, text, text) from %I', v_role);
      execute format('revoke all on function zuri_core.channel_secret_activate(text, text, text, integer, text) from %I', v_role);
      execute format('revoke all on function zuri_core.channel_secret_revoke(text, text, text, text, integer) from %I', v_role);
      execute format('revoke all on function zuri_core.channel_secret_resolve(text, text, text, text, text) from %I', v_role);
    end if;
  end loop;
end
$revoke_api_roles$;

grant usage on schema zuri_core to zuri_channel_vault_writer, zuri_channel_vault_reader;
grant execute on function zuri_core.channel_secret_write(text, text, text, text, jsonb, timestamptz, text, text) to zuri_channel_vault_writer;
grant execute on function zuri_core.channel_secret_activate(text, text, text, integer, text) to zuri_channel_vault_writer;
grant execute on function zuri_core.channel_secret_revoke(text, text, text, text, integer) to zuri_channel_vault_writer;
grant execute on function zuri_core.channel_secret_resolve(text, text, text, text, text) to zuri_channel_vault_reader;

comment on function zuri_core.channel_secret_write(text, text, text, text, jsonb, timestamptz, text, text) is
  'FR-223 — write a credential version PENDING_VALIDATION into Supabase Vault after re-proving the connection scope from rows. zuri_channel_vault_writer only.';
comment on function zuri_core.channel_secret_activate(text, text, text, integer, text) is
  'FR-223 — activate a validated version; supersede and purge the previous one. zuri_channel_vault_writer only.';
comment on function zuri_core.channel_secret_revoke(text, text, text, text, integer) is
  'FR-223 — reject one pending version, or revoke the credential and purge every version. zuri_channel_vault_writer only.';
comment on function zuri_core.channel_secret_resolve(text, text, text, text, text) is
  'FR-223 — resolve an ACTIVE version for its exact Tenant, Business, LINE connection and destination; no row for every refusal. zuri_channel_vault_reader only.';

commit;
