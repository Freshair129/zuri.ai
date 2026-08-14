-- @req FR-051, FR-052 - read-only production evidence after tenant bootstrap.
-- @spec BR-012, SDD-026, SEC-010 - one result row covers identity, RLS, grants and roles.
-- @tested supabase/tests/production_post_apply_inventory.sql

select
  (
    select count(*) = 1
    from zuri_core.business
    where id = '834fa869-62f3-431c-a287-e9a95e91175b'
      and tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and code = 'BUS-SMARTGIFT'
  ) as reserved_business_ok,
  (
    select count(*) = 1
    from zuri_core.line_channel_binding
    where id = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
      and tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
      and status = 'PENDING'
      and external_channel_id_hash is null
      and credential_hash is null
  ) as binding_pending_without_credentials,
  (select count(*) from zuri_core.business_knowledge) as knowledge_rows,
  to_regclass('public.business_knowledge') is null as legacy_public_table_removed,
  (
    select count(*) = 4 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'zuri_core'
      and c.relname in ('tenant', 'business', 'line_channel_binding', 'business_knowledge')
  ) as rls_enabled_and_forced,
  (
    select count(*) = 2
    from pg_policies
    where schemaname = 'zuri_core'
      and policyname in ('line_smartgift_binding_read', 'line_smartgift_knowledge_read')
      and roles = array['zuri_line_smartgift_ro']::name[]
  ) as exact_read_policies,
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'zuri_core'
      and grantee in ('anon', 'authenticated', 'service_role', 'zuri_line_smartgift_login')
  ) as no_base_table_grants_to_api_or_login_roles,
  (
    select count(*) = 2 and bool_and(
      not rolsuper and not rolinherit and not rolcreaterole and not rolcreatedb
      and not rolreplication and not rolbypassrls
      and (
        (rolname = 'zuri_line_smartgift_ro' and not rolcanlogin)
        or (rolname = 'zuri_line_smartgift_login' and rolcanlogin)
      )
    )
    from pg_roles
    where rolname in ('zuri_line_smartgift_ro', 'zuri_line_smartgift_login')
  ) as runtime_role_attributes_safe,
  exists (
    select 1
    from pg_auth_members m
    join pg_roles granted_role on granted_role.oid = m.roleid
    join pg_roles member_role on member_role.oid = m.member
    where granted_role.rolname = 'zuri_line_smartgift_ro'
      and member_role.rolname = 'zuri_line_smartgift_login'
  ) as login_can_set_read_role,
  (
    select array_agg(version order by version) = array['20260813192826', '20260813213654']::text[]
    from supabase_migrations.schema_migrations
    where version in ('20260813192826', '20260813213654')
  ) as expected_migrations_recorded;
