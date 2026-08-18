-- @req FR-078 — append the current contract-version receipt for the already
-- applied private Customer target schema without mutating the original audit.
-- @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:CDC-SG-CUSTOMER-DATA-001:contract-receipt'));

do $receipt_preflight$
begin
  if (select count(*) from zuri_core.customer) <> 0 then
    raise exception 'customer rows already exist; contract receipt must precede customer import';
  end if;
  if not exists (
    select 1 from zuri_core.person
    where id = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
      and code = 'PER-BOSS'
  ) then
    raise exception 'platform approver profile is missing';
  end if;
end
$receipt_preflight$;

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
  '3f9635a6-c7b7-4a39-9472-13ff25bb04c7',
  'CUSTOMER-TARGET-SCHEMA-CONTRACT-RECEIPT-CDC-SG-CUSTOMER-DATA-001',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  '834fa869-62f3-431c-a287-e9a95e91175b',
  'CDC-SG-CUSTOMER-DATA-001',
  'TARGET_SCHEMA_CONTRACT_RECEIPT',
  null,
  0,
  'MIS-SG-CUSTOMER-DATA-BACKFILL-001',
  jsonb_build_object(
    'contractVersion', 'VER-SG-CUSTOMER-DATA-CONTRACT-0.2.0B',
    'targetSchemaMigrationVersion', '20260818070000',
    'approverPersonId', 'c82690eb-84e8-48a8-8a28-fe3d839c2276',
    'containsRawPii', false,
    'customerRowsWritten', 0,
    'appendOnlyCorrectionOf', 'CUSTOMER-TARGET-SCHEMA-CDC-SG-CUSTOMER-DATA-001'
  )
)
on conflict (code) do nothing;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260818072000', 'customer_profile_contract_receipt')
on conflict (version) do nothing;

commit;
