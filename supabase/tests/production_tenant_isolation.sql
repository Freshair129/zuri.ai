-- @req FR-051, FR-052 - live Postgres proof for reserved ancestry and LINE read isolation.
-- @spec BR-012, SDD-026, SEC-010 - login has no direct grants; policy role sees one fixed scope.
-- @tested supabase/tests/production_tenant_isolation.sql

begin;

select 1 / case when exists (
  select 1
  from zuri_core.business
  where id = '834fa869-62f3-431c-a287-e9a95e91175b'
    and tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
    and code = 'BUS-SMARTGIFT'
) then 1 else 0 end as reserved_business_ok;

select 1 / case when to_regclass('public.business_knowledge') is null then 1 else 0 end
  as legacy_public_table_removed;

insert into zuri_core.portfolio (id, code, name)
values ('5e89f5c9-6047-420e-874f-6a514ef136c0', 'PF-ISOLATION-PROBE', 'Isolation Probe');
insert into zuri_core.tenant (id, portfolio_id, code, name)
values (
  'ef2552ce-ff10-4b1f-8212-d0a729f5a159',
  '5e89f5c9-6047-420e-874f-6a514ef136c0',
  'TNT-ISOLATION-PROBE',
  'Isolation Probe'
);
insert into zuri_core.business (id, tenant_id, code, name)
values (
  '6944ef44-7f05-4649-bda5-a76473ad4fe9',
  'ef2552ce-ff10-4b1f-8212-d0a729f5a159',
  'BUS-ISOLATION-PROBE',
  'Isolation Probe'
);

insert into zuri_core.business_knowledge (
  knowledge_id, tenant_id, business_id, bootstrap_batch_id, knowledge_type,
  product_code, name, source_ref, source_sha256, as_of, approved_at
)
values
  (
    'probe:smartgift:1',
    '77cdbe70-3111-4a04-922a-8059be99a8b0',
    '834fa869-62f3-431c-a287-e9a95e91175b',
    '948076f9-6a0a-43f3-88f5-d7225345ac8a',
    'PRODUCT', 'PROBE-SMARTGIFT', 'Visible SmartGift probe', 'probe:smartgift',
    repeat('a', 64), now(), now()
  ),
  (
    'probe:cross-tenant:1',
    'ef2552ce-ff10-4b1f-8212-d0a729f5a159',
    '6944ef44-7f05-4649-bda5-a76473ad4fe9',
    '948076f9-6a0a-43f3-88f5-d7225345ac8a',
    'PRODUCT', 'PROBE-CROSS-TENANT', 'Hidden cross-tenant probe', 'probe:cross-tenant',
    repeat('b', 64), now(), now()
  );

update zuri_core.line_channel_binding
set external_channel_id_hash = repeat('c', 64),
    credential_hash = repeat('d', 64),
    status = 'ACTIVE',
    valid_from = now() - interval '1 minute'
where id = '84ed2c90-ab44-46f3-9618-1f24df0744b9';

-- The local Supabase `postgres` role is intentionally not SUPERUSER. Temporary membership lets
-- this transaction impersonate the runtime login; ROLLBACK removes the test-only membership.
grant zuri_line_smartgift_login to postgres;
set local role zuri_line_smartgift_login;
select 1 / case when not has_schema_privilege(current_user, 'zuri_core', 'USAGE')
  then 1 else 0 end as login_has_no_direct_schema_usage;
select 1 / case when not has_table_privilege(
  current_user,
  (
    select c.oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'zuri_core' and c.relname = 'business_knowledge'
  ),
  'SELECT'
) then 1 else 0 end as login_has_no_direct_table_select;

set local role zuri_line_smartgift_ro;
select 1 / case when count(*) = 1 then 1 else 0 end as exact_scope_knowledge_rows
from zuri_core.business_knowledge;
select 1 / case when count(*) = 0 then 1 else 0 end as cross_tenant_rows_hidden
from zuri_core.business_knowledge
where tenant_id = 'ef2552ce-ff10-4b1f-8212-d0a729f5a159';
select 1 / case when count(*) = 1 then 1 else 0 end as exact_active_binding_rows
from zuri_core.line_channel_binding;
select 1 / case when not has_table_privilege(
  current_user, 'zuri_core.business_knowledge', 'INSERT,UPDATE,DELETE'
) then 1 else 0 end as policy_role_is_read_only;

rollback;
