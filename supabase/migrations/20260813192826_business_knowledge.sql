-- @req FR-047, FR-051 - curated knowledge with production Tenant/Business isolation.
-- @spec SDD-025, SDD-026, SEC-009, SEC-010
-- @tested tests/unit/postgres-business-knowledge.test.js

begin;
select pg_advisory_xact_lock(hashtext('zuri:bootstrap:prod:001'));

create schema if not exists zuri_core;
revoke all on schema zuri_core from public;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_line_smartgift_ro') then
    create role zuri_line_smartgift_ro login nobypassrls nocreatedb nocreaterole noinherit;
  end if;
end
$roles$;

create table if not exists zuri_core.portfolio (
  id text primary key check (id ~* '^[0-9a-f-]{36}$'),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE'
);

create table if not exists zuri_core.tenant (
  id text primary key check (id ~* '^[0-9a-f-]{36}$'),
  portfolio_id text not null references zuri_core.portfolio(id),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE'
);

create table if not exists zuri_core.business (
  id text primary key check (id ~* '^[0-9a-f-]{36}$'),
  tenant_id text not null references zuri_core.tenant(id),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE',
  unique (tenant_id, id)
);

create table if not exists zuri_core.line_channel_binding (
  id text primary key check (id ~* '^[0-9a-f-]{36}$'),
  code text not null unique,
  provider text not null check (provider = 'LINE'),
  tenant_id text not null,
  business_id text not null,
  external_channel_id_hash text,
  credential_hash text,
  status text not null default 'INACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  valid_from timestamptz,
  expires_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (tenant_id, business_id) references zuri_core.business(tenant_id, id)
);

create table if not exists zuri_core.business_knowledge (
  knowledge_id text primary key,
  tenant_id text not null,
  business_id text not null,
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
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-fA-F]{64}$'),
  as_of timestamptz not null,
  approved_at timestamptz not null,
  is_active boolean not null default true,
  sensitivity text not null default 'PUBLIC' check (sensitivity = 'PUBLIC'),
  contract_version text not null default '1.0.0' check (contract_version = '1.0.0'),
  bootstrap_batch_id text not null default '948076f9-6a0a-43f3-88f5-d7225345ac8a',
  unique (tenant_id, business_id, product_code),
  foreign key (tenant_id, business_id) references zuri_core.business(tenant_id, id)
);

create index if not exists business_knowledge_scope_idx
  on zuri_core.business_knowledge (tenant_id, business_id, is_active, product_code);

insert into zuri_core.portfolio (id, code, name)
values ('dfeaa9d2-7c65-48bc-9c30-ba083eac8439', 'PF-ZURI-OWNER', 'Zuri Owner Portfolio')
on conflict (id) do update set code = excluded.code, name = excluded.name;

insert into zuri_core.tenant (id, portfolio_id, code, name)
values ('77cdbe70-3111-4a04-922a-8059be99a8b0', 'dfeaa9d2-7c65-48bc-9c30-ba083eac8439', 'TNT-SMARTGIFT', 'SmartGift Tenant')
on conflict (id) do update set portfolio_id = excluded.portfolio_id, code = excluded.code, name = excluded.name;

insert into zuri_core.business (id, tenant_id, code, name)
values ('834fa869-62f3-431c-a287-e9a95e91175b', '77cdbe70-3111-4a04-922a-8059be99a8b0', 'BUS-SMARTGIFT', 'SmartGift')
on conflict (id) do update set tenant_id = excluded.tenant_id, code = excluded.code, name = excluded.name;

insert into zuri_core.line_channel_binding (id, code, provider, tenant_id, business_id, status)
values ('84ed2c90-ab44-46f3-9618-1f24df0744b9', 'LINE-SMARTGIFT-OA', 'LINE',
  '77cdbe70-3111-4a04-922a-8059be99a8b0', '834fa869-62f3-431c-a287-e9a95e91175b', 'INACTIVE')
on conflict (id) do update set tenant_id = excluded.tenant_id, business_id = excluded.business_id;

alter table zuri_core.business_knowledge enable row level security;
alter table zuri_core.business_knowledge force row level security;
alter table zuri_core.line_channel_binding enable row level security;
alter table zuri_core.line_channel_binding force row level security;

drop policy if exists line_smartgift_knowledge_read on zuri_core.business_knowledge;
create policy line_smartgift_knowledge_read on zuri_core.business_knowledge
  for select to zuri_line_smartgift_ro
  using (
    tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
    and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
    and sensitivity = 'PUBLIC'
    and is_active = true
  );

revoke all on all tables in schema zuri_core from anon, authenticated, service_role;
revoke all on all tables in schema zuri_core from zuri_line_smartgift_ro;
grant usage on schema zuri_core to zuri_line_smartgift_ro;
grant select on zuri_core.business_knowledge to zuri_line_smartgift_ro;

comment on table zuri_core.business_knowledge is
  'FR-051 Tenant-bound public product knowledge; private base table with forced RLS.';

commit;
