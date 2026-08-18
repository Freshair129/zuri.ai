-- @req FR-055 - controlled LINE activation and receipt persistence.
-- @spec NFR-013, SDD-028, SEC-012 - bounded CAS support, exact scope and least privilege.
-- @tested tests/unit/controlled-line-activation-migration.test.js, tests/integration/controlled-line-activation.postgres.test.js

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:controlled-line-activation:v1'));

do $precondition_guard$
begin
  if to_regclass('zuri_core.line_channel_binding') is null then
    raise exception 'ACTIVATION_PRECONDITION_FAILED: line_channel_binding is missing';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'zuri_app_runtime')
    or not exists (select 1 from pg_roles where rolname = 'zuri_line_smartgift_ro')
    or not exists (select 1 from pg_roles where rolname = 'zuri_line_smartgift_login') then
    raise exception 'ACTIVATION_PRECONDITION_FAILED: runtime roles are missing';
  end if;
end
$precondition_guard$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'zuri_line_activation_operator') then
    create role zuri_line_activation_operator noinherit nobypassrls nologin
      nosuperuser nocreatedb nocreaterole noreplication;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'zuri_line_activation_login') then
    create role zuri_line_activation_login login noinherit nobypassrls
      nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$roles$;

do $role_security_guard$
begin
  if exists (
    select 1 from pg_roles
    where rolname = 'zuri_line_activation_operator'
      and (rolsuper or rolinherit or rolcreaterole or rolcreatedb or rolcanlogin
        or rolreplication or rolbypassrls)
  ) or exists (
    select 1 from pg_roles
    where rolname = 'zuri_line_activation_login'
      and (rolsuper or rolinherit or rolcreaterole or rolcreatedb or not rolcanlogin
        or rolreplication or rolbypassrls)
  ) then
    raise exception 'ACTIVATION_ROLE_SECURITY_MISMATCH: operator role has privileged attributes';
  end if;
end
$role_security_guard$;

grant zuri_line_activation_operator to zuri_line_activation_login;

do $binding_ancestry_key$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'line_channel_binding_scope_id_key'
      and conrelid = 'zuri_core.line_channel_binding'::regclass
  ) then
    alter table zuri_core.line_channel_binding
      add constraint line_channel_binding_scope_id_key
      unique (tenant_id, business_id, id);
  end if;
end
$binding_ancestry_key$;

create table if not exists zuri_core.line_activation_event (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  correlation_id text not null check (correlation_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  event_type text not null check (event_type in ('ACTIVATION', 'ROLLBACK', 'CANARY_TRANSPORT')),
  receipt_state text not null constraint line_activation_event_receipt_state_value_check check (
    receipt_state in ('GENERATED', 'EVIDENCE_VERIFIED', 'ACCEPTED_BY_LINE', 'DISPLAYED_UNKNOWN', 'READ_UNKNOWN')
  ),
  project_ref text not null check (project_ref = 'qcnmhyglarzcpudjorzc'),
  tenant_id text not null,
  business_id text not null,
  binding_id text not null,
  binding_version_before integer not null check (binding_version_before > 0),
  binding_version_after integer not null check (binding_version_after > 0),
  canary_plan_sha256 text not null check (canary_plan_sha256 ~ '^[0-9a-f]{64}$'),
  golden_report_sha256 text not null check (golden_report_sha256 ~ '^[0-9a-f]{64}$'),
  isolation_report_sha256 text not null check (isolation_report_sha256 ~ '^[0-9a-f]{64}$'),
  provider_id text not null check (char_length(provider_id) between 1 and 200),
  model_id text not null check (char_length(model_id) between 1 and 200),
  approval_ref text not null check (char_length(approval_ref) between 1 and 200),
  transport_artifact_sha256 text check (transport_artifact_sha256 is null or transport_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  line_acceptance_class text check (
    line_acceptance_class is null
    or line_acceptance_class = 'HTTP_2XX'
  ),
  occurred_at timestamptz not null default now(),
  actor_fingerprint text not null check (actor_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint line_activation_event_binding_fkey
    foreign key (tenant_id, business_id, binding_id)
    references zuri_core.line_channel_binding (tenant_id, business_id, id),
  constraint line_activation_event_semantics_check check (
    (
      event_type in ('ACTIVATION', 'ROLLBACK')
      and receipt_state = 'EVIDENCE_VERIFIED'
      and binding_version_after = binding_version_before + 1
    )
    or (
      event_type = 'CANARY_TRANSPORT'
      and receipt_state in ('GENERATED', 'ACCEPTED_BY_LINE', 'DISPLAYED_UNKNOWN', 'READ_UNKNOWN')
      and binding_version_after = binding_version_before
    )
  ),
  constraint line_activation_event_transport_check check (
    (
      event_type in ('ACTIVATION', 'ROLLBACK')
      and transport_artifact_sha256 is null
      and line_acceptance_class is null
    )
    or (
      event_type = 'CANARY_TRANSPORT'
      and receipt_state = 'GENERATED'
      and line_acceptance_class is null
    )
    or (
      event_type = 'CANARY_TRANSPORT'
      and receipt_state in ('ACCEPTED_BY_LINE', 'DISPLAYED_UNKNOWN', 'READ_UNKNOWN')
      and transport_artifact_sha256 is not null
      and line_acceptance_class = 'HTTP_2XX'
    )
  ),
  unique (correlation_id, event_type, receipt_state)
);

create unique index if not exists line_activation_event_one_mutation_correlation_key
  on zuri_core.line_activation_event (correlation_id)
  where event_type in ('ACTIVATION', 'ROLLBACK');

create index if not exists line_activation_event_scope_time_idx
  on zuri_core.line_activation_event (tenant_id, business_id, binding_id, occurred_at desc);

alter table zuri_core.line_activation_event enable row level security;
alter table zuri_core.line_activation_event force row level security;

drop policy if exists line_smartgift_activation_binding_select on zuri_core.line_channel_binding;
create policy line_smartgift_activation_binding_select
on zuri_core.line_channel_binding for select
to zuri_line_activation_operator
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and id = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
  and code = 'LINE-SMARTGIFT-OA'
  and provider = 'LINE'
);

drop policy if exists line_smartgift_activation_binding_update on zuri_core.line_channel_binding;
create policy line_smartgift_activation_binding_update
on zuri_core.line_channel_binding for update
to zuri_line_activation_operator
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and id = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
  and code = 'LINE-SMARTGIFT-OA'
  and provider = 'LINE'
)
with check (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and id = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
  and code = 'LINE-SMARTGIFT-OA'
  and provider = 'LINE'
);

drop policy if exists line_smartgift_activation_event_select on zuri_core.line_activation_event;
create policy line_smartgift_activation_event_select
on zuri_core.line_activation_event for select
to zuri_line_activation_operator
using (
  project_ref = 'qcnmhyglarzcpudjorzc'
  and tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and binding_id = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
);

drop policy if exists line_smartgift_activation_event_insert on zuri_core.line_activation_event;
create policy line_smartgift_activation_event_insert
on zuri_core.line_activation_event for insert
to zuri_line_activation_operator
with check (
  project_ref = 'qcnmhyglarzcpudjorzc'
  and tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and binding_id = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
);

revoke all on zuri_core.line_activation_event from public, anon, authenticated, service_role, zuri_app_runtime, zuri_line_smartgift_ro, zuri_line_smartgift_login;
revoke update on zuri_core.line_channel_binding from public, anon, authenticated, service_role, zuri_app_runtime, zuri_line_smartgift_ro, zuri_line_smartgift_login;
revoke all on schema zuri_core from zuri_line_activation_login;
revoke all on zuri_core.line_channel_binding, zuri_core.line_activation_event from zuri_line_activation_login;

grant usage on schema zuri_core to zuri_line_activation_operator;
grant select on zuri_core.line_channel_binding to zuri_line_activation_operator;
grant update (
  external_channel_id_hash,
  credential_hash,
  status,
  valid_from,
  expires_at,
  updated_at,
  version
) on zuri_core.line_channel_binding to zuri_line_activation_operator;
grant insert, select on zuri_core.line_activation_event to zuri_line_activation_operator;

comment on table zuri_core.line_activation_event is
  'FR-055 append-only controlled activation and redacted canary receipt evidence.';

commit;
