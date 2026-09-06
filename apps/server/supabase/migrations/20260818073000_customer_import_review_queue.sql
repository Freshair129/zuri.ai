-- @req FR-078 — create the private, append-only review queue for the 130
-- SmartGift duplicate rows without storing raw source PII.
-- @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
-- The migration is schema-only. It does not publish a held row, create a
-- decision, or apply a customer update.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:CDC-SG-CUSTOMER-DATA-001:review-queue'));

do $precondition_guard$
begin
  if to_regclass('zuri_core.tenant') is null
    or to_regclass('zuri_core.business') is null
    or to_regclass('zuri_core.customer') is null
    or to_regclass('zuri_core.customer_import_batch') is null
    or to_regclass('zuri_core.customer_import_provenance') is null then
    raise exception 'CUSTOMER_REVIEW_QUEUE_PRECONDITION_FAILED: customer target schema is missing';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'zuri_app_runtime') then
    raise exception 'CUSTOMER_REVIEW_QUEUE_PRECONDITION_FAILED: zuri_app_runtime role is missing';
  end if;
end
$precondition_guard$;

alter table zuri_core.customer_import_provenance
  add column if not exists review_case_id text,
  add column if not exists review_reason_code text,
  add column if not exists review_evidence_json jsonb;

create table if not exists zuri_core.customer_import_review_case (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  batch_id text not null references zuri_core.customer_import_batch(id),
  tenant_id text not null,
  business_id text not null,
  reason_code text not null check (reason_code in ('DUPLICATE_NORMALIZED_NAME', 'DUPLICATE_SOURCE_KEY', 'DUPLICATE_TAX_ID', 'CROSS_BUSINESS', 'UNRESOLVED')),
  group_fingerprint text not null check (group_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'OPEN' check (status in ('OPEN', 'PARTIALLY_DECIDED', 'DECIDED', 'DEFERRED')),
  item_count integer not null default 0 check (item_count >= 1),
  evidence_summary_json jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_import_review_case_scope_fkey
    foreign key (tenant_id, business_id)
    references zuri_core.business (tenant_id, id)
);

create table if not exists zuri_core.customer_import_review_decision (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  review_case_id text not null references zuri_core.customer_import_review_case(id),
  provenance_id text not null references zuri_core.customer_import_provenance(id),
  decision_version integer not null default 1 check (decision_version > 0),
  action text not null check (action in ('CREATE_SEPARATE', 'LINK_EXISTING', 'REJECT', 'DEFER')),
  target_customer_id text references zuri_core.customer(id),
  decided_by_person_id text not null references zuri_core.person(id),
  decided_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint customer_import_review_decision_version_uq unique (provenance_id, decision_version)
);

do $review_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_import_provenance_review_case_fkey'
  ) then
    alter table zuri_core.customer_import_provenance
      add constraint customer_import_provenance_review_case_fkey
      foreign key (review_case_id) references zuri_core.customer_import_review_case(id);
  end if;
end
$review_constraints$;

create unique index if not exists customer_import_review_case_identity_uq
  on zuri_core.customer_import_review_case (batch_id, group_fingerprint);

create index if not exists customer_import_review_case_scope_idx
  on zuri_core.customer_import_review_case (tenant_id, business_id, status, updated_at desc);

create index if not exists customer_import_review_decision_case_idx
  on zuri_core.customer_import_review_decision (review_case_id, provenance_id, decision_version desc);

create index if not exists customer_import_provenance_review_case_idx
  on zuri_core.customer_import_provenance (review_case_id, resolution_status, disposition);

alter table zuri_core.person enable row level security;
alter table zuri_core.person force row level security;
alter table zuri_core.customer enable row level security;
alter table zuri_core.customer force row level security;
alter table zuri_core.customer_import_batch enable row level security;
alter table zuri_core.customer_import_batch force row level security;
alter table zuri_core.customer_import_provenance enable row level security;
alter table zuri_core.customer_import_provenance force row level security;
alter table zuri_core.customer_import_review_case enable row level security;
alter table zuri_core.customer_import_review_case force row level security;
alter table zuri_core.customer_import_review_decision enable row level security;
alter table zuri_core.customer_import_review_decision force row level security;

drop policy if exists customer_review_person_read on zuri_core.person;
create policy customer_review_person_read
on zuri_core.person for select
to zuri_app_runtime
using (
  id = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
  or exists (
    select 1
    from zuri_core.customer c
    where c.person_id = person.id
      and c.tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and c.business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
      and c.deleted_at is null
  )
);

drop policy if exists customer_review_customer_read on zuri_core.customer;
create policy customer_review_customer_read
on zuri_core.customer for select
to zuri_app_runtime
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  and deleted_at is null
);

drop policy if exists customer_review_batch_read on zuri_core.customer_import_batch;
create policy customer_review_batch_read
on zuri_core.customer_import_batch for select
to zuri_app_runtime
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
);

drop policy if exists customer_review_provenance_read on zuri_core.customer_import_provenance;
create policy customer_review_provenance_read
on zuri_core.customer_import_provenance for select
to zuri_app_runtime
using (
  review_case_id is not null
  and exists (
    select 1
    from zuri_core.customer_import_review_case rc
    where rc.id = review_case_id
      and rc.tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and rc.business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  )
);

drop policy if exists customer_review_provenance_prepare on zuri_core.customer_import_provenance;
create policy customer_review_provenance_prepare
on zuri_core.customer_import_provenance for update
to zuri_app_runtime
using (
  resolution_status = 'REVIEW_REQUIRED'
  and disposition = 'REVIEW'
  and exists (
    select 1
    from zuri_core.customer_import_batch b
    where b.id = batch_id
      and b.tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and b.business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  )
)
with check (
  review_case_id is not null
  and review_reason_code is not null
  and review_evidence_json is not null
);

drop policy if exists customer_review_case_read on zuri_core.customer_import_review_case;
create policy customer_review_case_read
on zuri_core.customer_import_review_case for select
to zuri_app_runtime
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
);

drop policy if exists customer_review_case_prepare on zuri_core.customer_import_review_case;
create policy customer_review_case_prepare
on zuri_core.customer_import_review_case for insert
to zuri_app_runtime
with check (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
);

drop policy if exists customer_review_case_update on zuri_core.customer_import_review_case;
create policy customer_review_case_update
on zuri_core.customer_import_review_case for update
to zuri_app_runtime
using (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
)
with check (
  tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
  and business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
);

drop policy if exists customer_review_decision_read on zuri_core.customer_import_review_decision;
create policy customer_review_decision_read
on zuri_core.customer_import_review_decision for select
to zuri_app_runtime
using (
  exists (
    select 1
    from zuri_core.customer_import_review_case rc
    where rc.id = review_case_id
      and rc.tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and rc.business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  )
);

drop policy if exists customer_review_decision_append on zuri_core.customer_import_review_decision;
create policy customer_review_decision_append
on zuri_core.customer_import_review_decision for insert
to zuri_app_runtime
with check (
  exists (
    select 1
    from zuri_core.customer_import_review_case rc
    where rc.id = review_case_id
      and rc.tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      and rc.business_id = '834fa869-62f3-431c-a287-e9a95e91175b'
  )
);

revoke all on table zuri_core.customer_import_review_case,
  zuri_core.customer_import_review_decision
  from public, anon, authenticated, service_role, zuri_line_smartgift_ro, zuri_line_smartgift_login;
revoke all on table zuri_core.person,
  zuri_core.customer,
  zuri_core.customer_import_batch,
  zuri_core.customer_import_provenance
  from zuri_line_smartgift_ro, zuri_line_smartgift_login;

grant usage on schema zuri_core to zuri_app_runtime;
grant select on zuri_core.person,
  zuri_core.customer,
  zuri_core.customer_import_batch,
  zuri_core.customer_import_provenance,
  zuri_core.customer_import_review_case,
  zuri_core.customer_import_review_decision
  to zuri_app_runtime;
grant insert on zuri_core.customer_import_review_case,
  zuri_core.customer_import_review_decision
  to zuri_app_runtime;
grant update (review_case_id, review_reason_code, review_evidence_json)
  on zuri_core.customer_import_provenance to zuri_app_runtime;
grant update (status, item_count, evidence_summary_json, version, updated_at)
  on zuri_core.customer_import_review_case to zuri_app_runtime;

comment on table zuri_core.customer_import_review_case is
  'FR-078 duplicate review group; stores only scope, hashes, counts and redacted evidence flags.';

comment on table zuri_core.customer_import_review_decision is
  'FR-078 append-only per-item human decision ledger; no update/delete grant is provided.';

comment on column zuri_core.customer_import_provenance.review_case_id is
  'Stable review-case back-reference; provenance id remains the immutable review-item id.';

insert into zuri_core.bootstrap_audit_event (
  id, code, tenant_id, business_id, migration_id, operation,
  artifact_sha256, row_count, correlation_id, details
)
values (
  'e4f884f7-f040-4da3-879c-28e6ff5a2e6e',
  'CUSTOMER-REVIEW-QUEUE-CDC-SG-CUSTOMER-DATA-001',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  '834fa869-62f3-431c-a287-e9a95e91175b',
  'CDC-SG-CUSTOMER-DATA-001',
  'CUSTOMER_REVIEW_QUEUE_SCHEMA_CREATED',
  null,
  0,
  'MIS-SG-CUSTOMER-DATA-BACKFILL-001',
  jsonb_build_object(
    'contractVersion', 'VER-SG-CUSTOMER-DATA-CONTRACT-0.3.0B',
    'rawPiiStored', false,
    'decisionsAppendOnly', true,
    'customerRowsPublished', 0,
    'heldRowsPublished', 0
  )
)
on conflict (code) do nothing;

commit;
