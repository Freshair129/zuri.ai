-- @req FR-079 — binding-scoped Phase 1 LINE connection selection.
-- @spec ADR-031 §D2/D3, SDD-043, SEC-015 — opaque secret refs, forced RLS,
-- database-enforced active-primary uniqueness and read-only runtime access.
-- @tested tests/unit/fr079-supabase-migration.test.js

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:phase1:line-runtime-connections:v1'));

do $precondition_guard$
begin
  if to_regclass('zuri_core.tenant') is null
    or to_regclass('zuri_core.business') is null
    or to_regclass('zuri_core.line_channel_binding') is null then
    raise exception 'PHASE1_CONNECTION_PRECONDITION_FAILED: tenant, business or binding is missing';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'zuri_line_smartgift_ro')
    or not exists (select 1 from pg_roles where rolname = 'zuri_line_smartgift_login') then
    raise exception 'PHASE1_CONNECTION_PRECONDITION_FAILED: runtime roles are missing';
  end if;
end
$precondition_guard$;

create table if not exists zuri_core.integration_provider (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  code text not null unique check (char_length(code) between 1 and 200),
  name text not null check (char_length(name) between 1 and 200),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  capabilities_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table if not exists zuri_core.integration_connection (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  tenant_id text not null,
  business_id text not null,
  provider_id text not null references zuri_core.integration_provider(id),
  name text not null check (char_length(name) between 1 and 200),
  authorization_type text not null default 'SECRET_MANAGER',
  external_account_id text,
  purpose text not null default 'GENERAL' check (purpose in ('GENERAL', 'PHASE1_LINE_LLM')),
  role text not null default 'SECONDARY' check (role in ('PRIMARY', 'SECONDARY')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'INACTIVE', 'ROTATED')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint integration_connection_business_fkey
    foreign key (tenant_id, business_id)
    references zuri_core.business (tenant_id, id),
  unique (tenant_id, provider_id, external_account_id)
);

create table if not exists zuri_core.integration_credential (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  connection_id text not null unique references zuri_core.integration_connection(id) on delete cascade,
  secret_ref text not null check (char_length(secret_ref) between 1 and 512),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'REVOKED')),
  expires_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create index if not exists integration_connection_scope_idx
  on zuri_core.integration_connection (tenant_id, business_id, purpose, status, role);

create unique index if not exists integration_connection_phase1_active_primary_key
  on zuri_core.integration_connection (tenant_id, business_id, purpose)
  where purpose = 'PHASE1_LINE_LLM' and status = 'ACTIVE' and role = 'PRIMARY';

create index if not exists integration_credential_active_connection_idx
  on zuri_core.integration_credential (connection_id, status, expires_at);

alter table zuri_core.integration_provider enable row level security;
alter table zuri_core.integration_provider force row level security;
alter table zuri_core.integration_connection enable row level security;
alter table zuri_core.integration_connection force row level security;
alter table zuri_core.integration_credential enable row level security;
alter table zuri_core.integration_credential force row level security;

drop policy if exists line_smartgift_integration_provider_read on zuri_core.integration_provider;
create policy line_smartgift_integration_provider_read
on zuri_core.integration_provider for select
to zuri_line_smartgift_ro
using (
  id in (
    select provider_id
    from zuri_core.integration_connection
    where tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
      and purpose = 'PHASE1_LINE_LLM'
      and status = 'ACTIVE'
      and role = 'PRIMARY'
  )
);

drop policy if exists line_smartgift_integration_connection_read on zuri_core.integration_connection;
create policy line_smartgift_integration_connection_read
on zuri_core.integration_connection for select
to zuri_line_smartgift_ro
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and purpose = 'PHASE1_LINE_LLM'
  and status = 'ACTIVE'
  and role = 'PRIMARY'
);

drop policy if exists line_smartgift_integration_credential_read on zuri_core.integration_credential;
create policy line_smartgift_integration_credential_read
on zuri_core.integration_credential for select
to zuri_line_smartgift_ro
using (
  exists (
    select 1
    from zuri_core.integration_connection c
    where c.id = connection_id
      and c.tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and c.business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
      and c.purpose = 'PHASE1_LINE_LLM'
      and c.status = 'ACTIVE'
      and c.role = 'PRIMARY'
  )
);

revoke all on zuri_core.integration_provider, zuri_core.integration_connection, zuri_core.integration_credential
  from public, anon, authenticated, service_role, zuri_app_runtime, zuri_line_smartgift_login;
revoke all on schema zuri_core from zuri_line_smartgift_login;
grant usage on schema zuri_core to zuri_line_smartgift_ro;
grant select on zuri_core.integration_provider, zuri_core.integration_connection, zuri_core.integration_credential
  to zuri_line_smartgift_ro;

comment on table zuri_core.integration_provider is
  'FR-079 provider metadata; production runtime reads only the selected binding-scoped provider.';
comment on table zuri_core.integration_connection is
  'FR-079 Business-scoped connection metadata; active-primary uniqueness is database-enforced.';
comment on column zuri_core.integration_credential.secret_ref is
  'Opaque external secret-manager reference only; never raw credential material.';

commit;
