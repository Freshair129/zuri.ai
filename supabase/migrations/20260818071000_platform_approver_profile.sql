-- @req FR-078 — create the named platform approver profile before any
-- SmartGift customer backfill write.
-- @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.
-- This migration creates one global human profile only; it creates no tenant
-- membership and does not imply organization ownership.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:CDC-SG-CUSTOMER-DATA-001:approver-profile'));

do $profile_preflight$
begin
  if exists (
    select 1 from zuri_core.person
    where code = 'PER-BOSS'
      and id <> 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
  ) then
    raise exception 'PER-BOSS is already bound to another person id';
  end if;
  if exists (
    select 1 from zuri_core.person
    where id = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
      and code <> 'PER-BOSS'
  ) then
    raise exception 'approver person id is already bound to another code';
  end if;
end
$profile_preflight$;

insert into zuri_core.person (id, code, display_name, email)
values (
  'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  'PER-BOSS',
  'Boss (บอส)',
  null
)
on conflict (id) do update set
  code = excluded.code,
  display_name = excluded.display_name,
  email = null,
  updated_at = now();

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
  'e6dc6edc-97c1-4aa2-8b34-a7d5fb82ee71',
  'CUSTOMER-APPROVER-PROFILE-CDC-SG-CUSTOMER-DATA-001',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  '834fa869-62f3-431c-a287-e9a95e91175b',
  'CDC-SG-CUSTOMER-DATA-001',
  'PLATFORM_APPROVER_PROFILE_CREATED',
  null,
  1,
  'MIS-SG-CUSTOMER-DATA-BACKFILL-001',
  jsonb_build_object(
    'personId', 'c82690eb-84e8-48a8-8a28-fe3d839c2276',
    'personCode', 'PER-BOSS',
    'role', 'PLATFORM_OWNER',
    'organizationMembershipCreated', false,
    'rawPiiStored', false
  )
)
on conflict (code) do nothing;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260818071000', 'platform_approver_profile')
on conflict (version) do nothing;

commit;
