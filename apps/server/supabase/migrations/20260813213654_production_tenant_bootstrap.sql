-- @req FR-051, FR-052 - production ancestry and LINE binding are database-enforced.
-- @spec SDD-026, SEC-010 - private schema, forced RLS, scope-bound machine role.
-- @tested tests/unit/supabase-production-isolation.test.js

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:production:tenant-bootstrap:v1'));

create schema if not exists zuri_core;
revoke all on schema zuri_core from public, anon, authenticated, service_role;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_app_runtime') then
    create role zuri_app_runtime noinherit nobypassrls nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'zuri_line_smartgift_ro') then
    create role zuri_line_smartgift_ro noinherit nobypassrls nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'zuri_line_smartgift_login') then
    create role zuri_line_smartgift_login login noinherit nobypassrls
      nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$roles$;

alter role zuri_app_runtime noinherit nobypassrls nologin;
alter role zuri_line_smartgift_ro noinherit nobypassrls nologin;

do $role_security_guard$
begin
  if exists (
    select 1 from pg_roles
    where rolname in ('zuri_app_runtime', 'zuri_line_smartgift_ro')
      and (rolsuper or rolinherit or rolcreaterole or rolcreatedb or rolcanlogin
        or rolreplication or rolbypassrls)
  ) or exists (
    select 1 from pg_roles
    where rolname = 'zuri_line_smartgift_login'
      and (rolsuper or rolinherit or rolcreaterole or rolcreatedb or not rolcanlogin
        or rolreplication or rolbypassrls)
  ) then
    raise exception 'ROLE_SECURITY_MISMATCH: Zuri runtime role has privileged attributes';
  end if;
end
$role_security_guard$;

grant zuri_line_smartgift_ro to zuri_line_smartgift_login;

create table if not exists zuri_core.portfolio (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table if not exists zuri_core.tenant (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  portfolio_id text not null references zuri_core.portfolio(id),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create index if not exists tenant_portfolio_idx
  on zuri_core.tenant (portfolio_id, status);

create table if not exists zuri_core.business (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  tenant_id text not null references zuri_core.tenant(id),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (tenant_id, id)
);

create index if not exists business_tenant_status_idx
  on zuri_core.business (tenant_id, status);

create table if not exists zuri_core.line_channel_binding (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  code text not null unique,
  provider text not null check (provider = 'LINE'),
  tenant_id text not null,
  business_id text not null,
  external_channel_id_hash text check (external_channel_id_hash is null or external_channel_id_hash ~ '^[0-9a-f]{64}$'),
  credential_hash text check (credential_hash is null or credential_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'INACTIVE', 'ROTATED')),
  valid_from timestamptz,
  expires_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint line_channel_binding_business_fkey
    foreign key (tenant_id, business_id)
    references zuri_core.business (tenant_id, id),
  constraint line_channel_binding_active_credentials_check check (
    status <> 'ACTIVE'
    or (external_channel_id_hash is not null and credential_hash is not null and valid_from is not null)
  )
);

create index if not exists line_channel_binding_scope_idx
  on zuri_core.line_channel_binding (tenant_id, business_id, status);

create table if not exists zuri_core.business_knowledge (
  knowledge_id text primary key,
  tenant_id text not null,
  business_id text not null,
  bootstrap_batch_id text not null,
  knowledge_type text not null check (knowledge_type = 'PRODUCT'),
  product_code text not null,
  name text not null,
  category text,
  description text,
  unit text,
  sell_price numeric(14, 2) check (sell_price is null or sell_price >= 0),
  currency text check (currency is null or char_length(currency) = 3),
  moq integer check (moq is null or moq >= 0),
  colors text[] not null default '{}',
  specification jsonb not null default '{}'::jsonb,
  source_ref text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  as_of timestamptz not null,
  approved_at timestamptz not null,
  is_active boolean not null default true,
  sensitivity text not null default 'PUBLIC' check (sensitivity = 'PUBLIC'),
  contract_version text not null default '1.0.0' check (contract_version = '1.0.0'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_knowledge_business_fkey
    foreign key (tenant_id, business_id)
    references zuri_core.business (tenant_id, id),
  unique (tenant_id, business_id, product_code)
);

create index if not exists business_knowledge_scope_product_idx
  on zuri_core.business_knowledge (tenant_id, business_id, is_active, product_code);

create table if not exists zuri_core.bootstrap_audit_event (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  code text not null unique,
  tenant_id text,
  business_id text,
  migration_id text not null,
  operation text not null,
  artifact_sha256 text check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null default 0 check (row_count >= 0),
  correlation_id text not null,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);

do $identity_guard$
begin
  if exists (
    select 1 from zuri_core.portfolio
    where code = 'PF-ZURI-OWNER' and id <> 'dfeaa9d2-7c65-48bc-9c30-ba083eac8439'
  ) or exists (
    select 1 from zuri_core.tenant
    where code = 'TNT-SMARTGIFT' and id <> '77cdbe70-3111-4a04-922a-8059be99a8b0'
  ) or exists (
    select 1 from zuri_core.business
    where code = 'BUS-SMARTGIFT' and id <> '834fa869-62f3-431c-a287-e9a95e91175b'
  ) or exists (
    select 1 from zuri_core.line_channel_binding
    where code = 'LINE-SMARTGIFT-OA' and id <> '84ed2c90-ab44-46f3-9618-1f24df0744b9'
  ) or exists (
    select 1 from zuri_core.bootstrap_audit_event
    where code = 'BOOTSTRAP-PROD-001' and id <> '948076f9-6a0a-43f3-88f5-d7225345ac8a'
  ) then
    raise exception 'BOOTSTRAP_IDENTITY_MISMATCH: reserved code already has another id';
  end if;
end
$identity_guard$;

insert into zuri_core.portfolio (id, code, name)
values ('dfeaa9d2-7c65-48bc-9c30-ba083eac8439', 'PF-ZURI-OWNER', 'Zuri Owner Portfolio')
on conflict (code) do update set
  name = excluded.name,
  updated_at = now(),
  version = zuri_core.portfolio.version + 1;

insert into zuri_core.tenant (id, portfolio_id, code, name)
values (
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  'dfeaa9d2-7c65-48bc-9c30-ba083eac8439',
  'TNT-SMARTGIFT',
  'SmartGift Tenant'
)
on conflict (code) do update set
  portfolio_id = excluded.portfolio_id,
  name = excluded.name,
  updated_at = now(),
  version = zuri_core.tenant.version + 1;

insert into zuri_core.business (id, tenant_id, code, name)
values (
  '834fa869-62f3-431c-a287-e9a95e91175b',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  'BUS-SMARTGIFT',
  'SmartGift'
)
on conflict (code) do update set
  tenant_id = excluded.tenant_id,
  name = excluded.name,
  updated_at = now(),
  version = zuri_core.business.version + 1;

insert into zuri_core.line_channel_binding (
  id, code, provider, tenant_id, business_id, status
)
values (
  '84ed2c90-ab44-46f3-9618-1f24df0744b9',
  'LINE-SMARTGIFT-OA',
  'LINE',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  '834fa869-62f3-431c-a287-e9a95e91175b',
  'PENDING'
)
on conflict (code) do update set
  tenant_id = excluded.tenant_id,
  business_id = excluded.business_id,
  updated_at = now(),
  version = zuri_core.line_channel_binding.version + 1;

insert into zuri_core.bootstrap_audit_event (
  id, code, tenant_id, business_id, migration_id, operation, correlation_id, details
)
values (
  '948076f9-6a0a-43f3-88f5-d7225345ac8a',
  'BOOTSTRAP-PROD-001',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  '834fa869-62f3-431c-a287-e9a95e91175b',
  '20260813213654',
  'PRODUCTION_TENANT_BOOTSTRAP',
  '948076f9-6a0a-43f3-88f5-d7225345ac8a',
  jsonb_build_object('lineBindingStatus', 'PENDING', 'knowledgeRows', 0)
)
on conflict (code) do update set
  tenant_id = excluded.tenant_id,
  business_id = excluded.business_id,
  details = excluded.details;

do $legacy_knowledge$
begin
  if to_regclass('public.business_knowledge') is not null then
    execute format($migration$
      insert into zuri_core.business_knowledge (
        knowledge_id, tenant_id, business_id, bootstrap_batch_id, knowledge_type,
        product_code, name, category, description, unit, sell_price, currency, moq,
        colors, specification, source_ref, source_sha256, as_of, approved_at,
        is_active, sensitivity, contract_version
      )
      select
        knowledge_id,
        '77cdbe70-3111-4a04-922a-8059be99a8b0',
        '834fa869-62f3-431c-a287-e9a95e91175b',
        '948076f9-6a0a-43f3-88f5-d7225345ac8a',
        knowledge_type, product_code, name, category, description, unit, sell_price,
        currency, moq, colors, specification, source_ref, lower(source_sha256), as_of,
        approved_at, is_active, sensitivity, contract_version
      from %I.%I
      where business_id in ('smartgift', '834fa869-62f3-431c-a287-e9a95e91175b')
      on conflict (tenant_id, business_id, product_code) do update set
        knowledge_id = excluded.knowledge_id,
        name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        unit = excluded.unit,
        sell_price = excluded.sell_price,
        currency = excluded.currency,
        moq = excluded.moq,
        colors = excluded.colors,
        specification = excluded.specification,
        source_ref = excluded.source_ref,
        source_sha256 = excluded.source_sha256,
        as_of = excluded.as_of,
        approved_at = excluded.approved_at,
        is_active = excluded.is_active,
        updated_at = now()
    $migration$, 'public', 'business_knowledge');

    execute 'revoke all on table public.business_knowledge from public, anon, authenticated, service_role';
    execute 'drop table public.business_knowledge';
  end if;
end
$legacy_knowledge$;

alter table zuri_core.tenant enable row level security;
alter table zuri_core.tenant force row level security;
alter table zuri_core.business enable row level security;
alter table zuri_core.business force row level security;
alter table zuri_core.line_channel_binding enable row level security;
alter table zuri_core.line_channel_binding force row level security;
alter table zuri_core.business_knowledge enable row level security;
alter table zuri_core.business_knowledge force row level security;

drop policy if exists line_smartgift_binding_read on zuri_core.line_channel_binding;
create policy line_smartgift_binding_read
on zuri_core.line_channel_binding for select
to zuri_line_smartgift_ro
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and status = 'ACTIVE'
  and valid_from <= now()
  and (expires_at is null or expires_at > now())
);

drop policy if exists line_smartgift_knowledge_read on zuri_core.business_knowledge;
create policy line_smartgift_knowledge_read
on zuri_core.business_knowledge for select
to zuri_line_smartgift_ro
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and sensitivity = 'PUBLIC'
  and is_active
);

revoke all on all tables in schema zuri_core from public, anon, authenticated, service_role;
revoke all on all sequences in schema zuri_core from public, anon, authenticated, service_role;
revoke all on all functions in schema zuri_core from public, anon, authenticated, service_role;
revoke all on schema zuri_core from zuri_line_smartgift_login;
revoke all on all tables in schema zuri_core from zuri_line_smartgift_login;
revoke all on all sequences in schema zuri_core from zuri_line_smartgift_login;
revoke all on all functions in schema zuri_core from zuri_line_smartgift_login;
grant usage on schema zuri_core to zuri_line_smartgift_ro;
grant select on zuri_core.line_channel_binding, zuri_core.business_knowledge
  to zuri_line_smartgift_ro;

alter default privileges in schema zuri_core revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema zuri_core revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema zuri_core revoke execute on functions from public, anon, authenticated, service_role;

comment on schema zuri_core is 'Private Zuri production relational authority; not exposed by Data API.';
comment on table zuri_core.business_knowledge is 'FR-051 tenant-isolated curated product knowledge for LINE Phase 1.';
comment on table zuri_core.line_channel_binding is 'Server-owned LINE destination and credential binding; raw secrets are never stored.';

commit;
