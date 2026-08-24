-- @req FR-094, FR-095, FR-096, FR-097, FR-098 — move the hosted application
-- connection off the privileged postgres owner while preserving the shared IAM
-- policy boundary.
-- @spec ADR-018 D3-D5, ADR-045 D2-D6, SDD-052, SEC-018
-- @tested tests/unit/canonical-iam-runtime-role-cutover.test.js
--
-- Production role-preparation artifact. This migration deliberately does not
-- set a password. The deployment secret is rotated separately after the
-- catalog/grant/RLS canary passes. Never put a role password in Git, SQL
-- migration text or chat.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:canonical-iam:runtime-role:v1'));

do $precondition_guard$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_app_runtime') then
    raise exception 'CANONICAL_IAM_RUNTIME_ROLE_PRECONDITION_FAILED: zuri_app_runtime is missing';
  end if;

  if exists (
    select 1
    from pg_roles
    where rolname = 'zuri_app_runtime'
      and (rolsuper or rolbypassrls or rolcanlogin or rolinherit or rolcreaterole
        or rolcreatedb or rolreplication)
  ) then
    raise exception 'CANONICAL_IAM_RUNTIME_ROLE_SECURITY_MISMATCH: zuri_app_runtime is privileged or login-capable';
  end if;
end
$precondition_guard$;

do $login_role$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_web_login') then
    create role zuri_web_login login inherit nobypassrls
      nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$login_role$;

do $login_role_guard$
begin
  if exists (
    select 1
    from pg_roles
    where rolname = 'zuri_web_login'
      and (rolsuper or rolbypassrls or not rolcanlogin or not rolinherit
        or rolcreaterole or rolcreatedb or rolreplication)
  ) then
    raise exception 'CANONICAL_IAM_WEB_LOGIN_SECURITY_MISMATCH: zuri_web_login is privileged, cannot login or cannot inherit';
  end if;
end
$login_role_guard$;

revoke all on schema public from zuri_web_login;
revoke all on all tables in schema public from zuri_web_login;
revoke all on all sequences in schema public from zuri_web_login;
revoke all on all functions in schema public from zuri_web_login;

grant zuri_app_runtime to zuri_web_login
  with inherit true, set false, admin false;

grant usage on schema public to zuri_app_runtime;

do $table_grants$
declare
  table_record record;
begin
  for table_record in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format(
      'grant select, insert, update, delete on table %I.%I to zuri_app_runtime',
      table_record.schema_name,
      table_record.table_name
    );
    execute format(
      'alter table %I.%I enable row level security',
      table_record.schema_name,
      table_record.table_name
    );
  end loop;
end
$table_grants$;

grant usage, select, update on all sequences in schema public to zuri_app_runtime;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to zuri_app_runtime;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to zuri_app_runtime;

do $runtime_policies$
declare
  table_record record;
begin
  for table_record in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = table_record.schema_name
        and tablename = table_record.table_name
        and policyname = 'zuri_app_runtime_all'
    ) then
      execute format(
        'create policy %I on %I.%I for all to zuri_app_runtime, zuri_web_login using (true) with check (true)',
        'zuri_app_runtime_all',
        table_record.schema_name,
        table_record.table_name
      );
    elsif not exists (
      select 1
      from pg_policies
      where schemaname = table_record.schema_name
        and tablename = table_record.table_name
        and policyname = 'zuri_app_runtime_all'
        and roles @> array['zuri_app_runtime'::name, 'zuri_web_login'::name]
        and cmd = '*'
        and permissive
    ) then
      raise exception 'CANONICAL_IAM_RUNTIME_POLICY_COLLISION: %.%',
        table_record.schema_name,
        table_record.table_name;
    end if;
  end loop;
end
$runtime_policies$;

comment on role zuri_web_login is
  'Hosted Zuri web login; no password in migration; inherits only zuri_app_runtime after secure deployment-secret rotation.';

commit;
