-- @req FR-080 — production Phase 1 secrets resolve from Supabase Vault through
-- a private server-side function, never through a Data API table grant.
-- @spec ADR-032 D2/D3, ADR-031 D3, SEC-016, SDD-044
-- @tested tests/unit/fr080-supabase-vault.test.js

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:phase1:supabase-vault-resolver:v1'));

do $precondition_guard$
begin
  if to_regclass('zuri_core.integration_connection') is null
    or to_regclass('zuri_core.integration_credential') is null
    or not exists (select 1 from pg_roles where rolname = 'zuri_line_smartgift_login') then
    raise exception 'PHASE1_VAULT_PRECONDITION_FAILED: connection metadata or login role is missing';
  end if;
end
$precondition_guard$;

do $vault_owner_guard$
begin
  if to_regclass('vault.decrypted_secrets') is null
    or not has_table_privilege(current_user, 'vault.decrypted_secrets', 'select') then
    raise exception 'PHASE1_VAULT_PRECONDITION_FAILED: migration executor must be able to read vault.decrypted_secrets';
  end if;
end
$vault_owner_guard$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_line_runtime') then
    create role zuri_line_runtime noinherit nobypassrls nologin;
  end if;
end
$roles$;

alter role zuri_line_runtime noinherit nobypassrls nologin;
grant zuri_line_runtime to zuri_line_smartgift_login;

create or replace function zuri_core.resolve_phase1_line_secret(
  p_secret_ref text,
  p_tenant_id text,
  p_business_id text
)
returns table (
  secret_material text,
  version text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, zuri_core, vault
as $function$
declare
  vault_secret_id uuid;
  credential_version text;
  credential_expiry timestamptz;
begin
  if p_secret_ref is null
    or p_secret_ref !~* '^supabase-vault:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return;
  end if;

  begin
    vault_secret_id := substring(p_secret_ref from '^supabase-vault:(.*)$')::uuid;
  exception when invalid_text_representation then
    return;
  end;

  select c.version::text, c.expires_at
    into credential_version, credential_expiry
  from zuri_core.integration_credential c
  join zuri_core.integration_connection i on i.id = c.connection_id
  where c.secret_ref = p_secret_ref
    and c.status = 'ACTIVE'
    and (c.expires_at is null or c.expires_at > now())
    and i.tenant_id = p_tenant_id
    and i.business_id = p_business_id
    and i.purpose = 'PHASE1_LINE_LLM'
    and i.status = 'ACTIVE'
    and i.role = 'PRIMARY';

  if not found then
    return;
  end if;

  select v.decrypted_secret
    into secret_material
  from vault.decrypted_secrets v
  where v.id = vault_secret_id;

  if secret_material is null then
    return;
  end if;

  version := format('credential-v%s', credential_version);
  -- A nullable metadata expiry still receives a short refresh deadline so the
  -- runtime never caches a Vault value beyond the hard SecretManagerPort bound.
  expires_at := coalesce(credential_expiry, now() + interval '5 minutes');
  return next;
end
$function$;

revoke all on function zuri_core.resolve_phase1_line_secret(text, text, text)
  from public, anon, authenticated, service_role, zuri_line_smartgift_ro, zuri_line_smartgift_login;
revoke all on schema zuri_core from zuri_line_runtime;
grant usage on schema zuri_core to zuri_line_runtime;
grant execute on function zuri_core.resolve_phase1_line_secret(text, text, text)
  to zuri_line_runtime;

comment on function zuri_core.resolve_phase1_line_secret(text, text, text) is
  'FR-080 private resolver: only zuri_line_runtime may resolve an active primary opaque Supabase Vault reference for the binding scope.';

commit;
