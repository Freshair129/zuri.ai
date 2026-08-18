-- @req FR-078 — establish the private Person/Customer target and the
-- provenance/idempotency boundary before any SmartGift customer write.
-- @spec CDC-SG-CUSTOMER-DATA-001 v1.0.0, ADR-007, ADR-018.
-- This migration contains no customer rows and no source PII.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:CDC-SG-CUSTOMER-DATA-001:schema'));

create table if not exists zuri_core.person (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  code text not null unique,
  display_name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists zuri_core.customer (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  code text not null unique,
  tenant_id text not null,
  business_id text not null,
  person_id text not null,
  display_name text not null,
  lifecycle_stage text not null default 'LEAD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  constraint customer_person_fkey
    foreign key (person_id) references zuri_core.person (id),
  constraint customer_business_fkey
    foreign key (tenant_id, business_id)
    references zuri_core.business (tenant_id, id)
);

create index if not exists customer_scope_idx
  on zuri_core.customer (tenant_id, business_id, deleted_at);

create index if not exists customer_person_idx
  on zuri_core.customer (person_id);

create table if not exists zuri_core.customer_import_batch (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  contract_id text not null,
  mission_id text not null,
  version_id text not null,
  tenant_id text not null,
  business_id text not null,
  source_ref text not null,
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_row_count integer not null check (source_row_count >= 0),
  publish_row_count integer not null default 0 check (publish_row_count >= 0),
  held_row_count integer not null default 0 check (held_row_count >= 0),
  status text not null check (status in ('DRY_RUN', 'APPROVED', 'APPLIED', 'ROLLED_BACK', 'FAILED')),
  approved_by_person_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_import_batch_scope_fkey
    foreign key (tenant_id, business_id)
    references zuri_core.business (tenant_id, id),
  constraint customer_import_batch_approver_fkey
    foreign key (approved_by_person_id) references zuri_core.person (id)
);

create unique index if not exists customer_import_batch_identity_idx
  on zuri_core.customer_import_batch (contract_id, mission_id, version_id, snapshot_sha256);

create table if not exists zuri_core.customer_import_provenance (
  id text primary key check (id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  batch_id text not null,
  source_system text not null,
  source_table text not null check (source_table in ('customer', 'stg_contact')),
  source_record_key text not null,
  source_row integer,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null unique,
  resolution_status text not null check (resolution_status in ('AUTO_MATCH', 'NEW_CANDIDATE', 'REVIEW_REQUIRED', 'UNRESOLVED', 'REJECTED')),
  match_method text not null check (match_method in ('EXACT_SOURCE_KEY', 'EXACT_TAX_ID', 'EXACT_NAME_AND_CORROBORATION', 'EXPLICIT_INTERNAL_MAPPING', 'NONE')),
  disposition text not null check (disposition in ('PUBLISH', 'HOLD', 'REVIEW', 'REJECT')),
  person_id text,
  customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_import_provenance_batch_fkey
    foreign key (batch_id) references zuri_core.customer_import_batch (id),
  constraint customer_import_provenance_person_fkey
    foreign key (person_id) references zuri_core.person (id),
  constraint customer_import_provenance_customer_fkey
    foreign key (customer_id) references zuri_core.customer (id),
  constraint customer_import_provenance_source_identity_uq
    unique (source_system, source_table, source_record_key, snapshot_sha256)
);

create index if not exists customer_import_provenance_batch_status_idx
  on zuri_core.customer_import_provenance (batch_id, resolution_status, disposition);

create index if not exists customer_import_provenance_target_idx
  on zuri_core.customer_import_provenance (person_id, customer_id);

alter table zuri_core.person enable row level security;
alter table zuri_core.person force row level security;
alter table zuri_core.customer enable row level security;
alter table zuri_core.customer force row level security;
alter table zuri_core.customer_import_batch enable row level security;
alter table zuri_core.customer_import_batch force row level security;
alter table zuri_core.customer_import_provenance enable row level security;
alter table zuri_core.customer_import_provenance force row level security;

revoke all on table zuri_core.person,
  zuri_core.customer,
  zuri_core.customer_import_batch,
  zuri_core.customer_import_provenance
  from public, anon, authenticated, service_role;

comment on table zuri_core.person is
  'Private CRM Person identity. Historical SmartGift imports may create rows only after CDC approval.';

comment on table zuri_core.customer is
  'Private tenant/business-scoped CRM Customer projection. No source key or raw contact field is stored here.';

comment on table zuri_core.customer_import_batch is
  'Private, batch-scoped customer backfill receipt and rollback boundary; contains no raw PII.';

comment on table zuri_core.customer_import_provenance is
  'Private, append-only source identity/idempotency ledger; raw PII is intentionally excluded.';

insert into zuri_core.bootstrap_audit_event (
  id,
  code,
  tenant_id,
  business_id,
  migration_id,
  operation,
  artifact_sha256,
  row_count,
  correlation_id,
  details
)
values (
  '4c0cfd2f-2c72-4a8f-8b1c-5e20ab62b3a1',
  'CUSTOMER-TARGET-SCHEMA-CDC-SG-CUSTOMER-DATA-001',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  '834fa869-62f3-431c-a287-e9a95e91175b',
  'CDC-SG-CUSTOMER-DATA-001',
  'TARGET_SCHEMA_CREATED',
  'a8da233228cb80a088f11ff98fdef5773d0890bc158bcc40752c6d7a5e4bd5d7',
  0,
  'MIS-SG-CUSTOMER-DATA-BACKFILL-001',
  jsonb_build_object(
    'contractVersion', 'VER-SG-CUSTOMER-DATA-CONTRACT-0.1.0B',
    'migrationVersion', '20260818070000',
    'tables', jsonb_build_array('person', 'customer', 'customer_import_batch', 'customer_import_provenance'),
    'containsRawPii', false,
    'customerRowsWritten', 0
  )
)
on conflict (code) do nothing;

commit;
