import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-051, FR-071 — build the reviewed, bounded SmartGift customer-scope
// migration and a rollback artifact from the approved import and backup.
// @spec ADR-018 D7/D8, PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.

const root = process.cwd()
const artifactDir = path.join(root, 'artifacts/migrations/MIS-SG-CUSTOMER-DATA-MIGRATION-001')
const candidatePath = path.join(artifactDir, 'candidate-remote-scope-import.sql')
const backupPath = path.join(artifactDir, 'supabase-before-migration-backup.json')
const migrationPath = path.join(root, 'supabase/migrations/20260818060000_customer_wannapa_identity_and_smartgift_cutover.sql')
const rollbackPath = path.join(artifactDir, 'rollback-customer-scope-cutover.sql')

const ids = {
  missionId: 'MIS-SG-CUSTOMER-DATA-MIGRATION-001',
  versionId: 'VER-SG-DATA-MIGRATION-0.2.0B',
  approverPersonId: 'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  portfolioId: '5c621811-7e7a-42dd-ac39-ea9e8416ba98',
  oldPortfolioId: 'dfeaa9d2-7c65-48bc-9c30-ba083eac8439',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  smartGiftBusinessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  etohMukuBusinessId: 'ad6627eb-cc3c-4465-8d55-10ef68786fa3',
  mujeenBusinessId: 'dc84f828-df37-4417-84e0-63b863bedb34',
  emcBusinessId: '161c1acf-7c0a-44bc-875c-39bee1628685',
  batchId: '32a14e35-8896-45b5-b949-4ca1dda24620',
  cutoverAuditId: '4a06e228-e85c-44a2-af55-3562756ce31e',
  rollbackAuditId: '0b7c0f2e-7b9f-4b16-9e5e-1c3c9c6a0b5a',
  artifactSha256: '769d6f83743656591ff095f945f3f32aa8d8b9702dfc5cbb4184011260082717',
  migrationVersion: '20260818060000',
  migrationName: 'customer_wannapa_identity_and_smartgift_cutover',
}

const candidate = fs.readFileSync(candidatePath, 'utf8')
const importBody = candidate
  .replace(/^.*?\nbegin;\s*/s, '')
  .replace(/\s*commit;\s*$/s, '')
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'))
const oldRows = backup.tables.businessKnowledge.map((row) => ({
  knowledge_id: row.knowledge_id,
  business_id: row.business_id,
  knowledge_type: row.knowledge_type,
  product_code: row.product_code,
  name: row.name,
  category: row.category,
  description: row.description,
  unit: row.unit,
  sell_price: row.sell_price,
  currency: row.currency,
  moq: row.moq,
  colors: row.colors,
  specification: row.specification,
  source_ref: row.source_ref,
  source_sha256: row.source_sha256,
  as_of: row.as_of,
  approved_at: row.approved_at,
  is_active: row.is_active,
  sensitivity: row.sensitivity,
  contract_version: row.contract_version,
}))
const oldRowsBase64 = Buffer.from(JSON.stringify(oldRows), 'utf8').toString('base64')
const rollbackSha256 = crypto.createHash('sha256').update(JSON.stringify(oldRows), 'utf8').digest('hex')

const migration = `-- @req FR-051, FR-071 — customer identity cutover and approved SmartGift knowledge import.
-- @spec ADR-018 D7/D8 — bounded transaction, advisory lock, RLS and audit evidence.
-- Mission: ${ids.missionId}; version: ${ids.versionId}; approver Person: ${ids.approverPersonId}
-- This migration keeps the existing production Tenant/SmartGift UUIDs, relabels
-- the pilot scope as customer-owned, adds the three missing Businesses, and
-- imports only the approved 74-row public product artifact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:${ids.missionId}'));

do $identity_preflight$
begin
  if exists (
    select 1 from zuri_core.portfolio
    where code = 'PF-WANNAPA-WORKSPACE' and id <> '${ids.portfolioId}'
  ) then
    raise exception 'customer portfolio code is already bound to another id';
  end if;
  if not exists (
    select 1 from zuri_core.tenant
    where id = '${ids.tenantId}' and code in ('TNT-SMARTGIFT', 'TNT-ETOHGROUP')
  ) then
    raise exception 'expected production SmartGift tenant identity is missing';
  end if;
  if exists (
    select 1 from zuri_core.tenant
    where code = 'TNT-ETOHGROUP' and id <> '${ids.tenantId}'
  ) then
    raise exception 'customer tenant code is already bound to another id';
  end if;
  if not exists (
    select 1 from zuri_core.business
    where id = '${ids.smartGiftBusinessId}' and code = 'BUS-SMARTGIFT'
  ) then
    raise exception 'expected production SmartGift business identity is missing';
  end if;
  if exists (
    select 1 from zuri_core.business
    where code in ('BUS-ETOH-MUKU', 'BUS-MUJEEN', 'BUS-EMC')
      and id not in ('${ids.etohMukuBusinessId}', '${ids.mujeenBusinessId}', '${ids.emcBusinessId}')
  ) then
    raise exception 'one of the customer business codes is already bound to another id';
  end if;
  if exists (
    select 1 from zuri_core.business
    where id = '${ids.etohMukuBusinessId}' and code <> 'BUS-ETOH-MUKU'
  ) or exists (
    select 1 from zuri_core.business
    where id = '${ids.mujeenBusinessId}' and code <> 'BUS-MUJEEN'
  ) or exists (
    select 1 from zuri_core.business
    where id = '${ids.emcBusinessId}' and code <> 'BUS-EMC'
  ) then
    raise exception 'one of the customer business ids is already bound to another code';
  end if;
end
$identity_preflight$;

insert into zuri_core.portfolio (id, code, name, status)
values ('${ids.portfolioId}', 'PF-WANNAPA-WORKSPACE', 'Wannapa Workspace', 'ACTIVE')
on conflict (id) do update set
  code = excluded.code,
  name = excluded.name,
  status = excluded.status,
  updated_at = now(),
  version = zuri_core.portfolio.version + 1;

update zuri_core.tenant
set portfolio_id = '${ids.portfolioId}',
    code = 'TNT-ETOHGROUP',
    name = 'TNT-EtohGroup',
    status = 'ACTIVE',
    updated_at = now(),
    version = version + 1
where id = '${ids.tenantId}';

update zuri_core.business
set tenant_id = '${ids.tenantId}',
    code = 'BUS-SMARTGIFT',
    name = 'SmartGift',
    status = 'ACTIVE',
    updated_at = now(),
    version = version + 1
where id = '${ids.smartGiftBusinessId}';

insert into zuri_core.business (id, tenant_id, code, name, status)
values
  ('${ids.etohMukuBusinessId}', '${ids.tenantId}', 'BUS-ETOH-MUKU', 'Etoh-Muku', 'ACTIVE'),
  ('${ids.mujeenBusinessId}', '${ids.tenantId}', 'BUS-MUJEEN', 'Mujeen', 'ACTIVE'),
  ('${ids.emcBusinessId}', '${ids.tenantId}', 'BUS-EMC', 'EMC', 'ACTIVE')
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  code = excluded.code,
  name = excluded.name,
  status = excluded.status,
  updated_at = now(),
  version = zuri_core.business.version + 1;

alter table zuri_core.business_knowledge enable row level security;
alter table zuri_core.business_knowledge force row level security;
alter table zuri_core.line_channel_binding enable row level security;
alter table zuri_core.line_channel_binding force row level security;

drop policy if exists line_smartgift_knowledge_read on zuri_core.business_knowledge;
create policy line_smartgift_knowledge_read
on zuri_core.business_knowledge for select
to zuri_line_smartgift_ro
using (
  tenant_id = '${ids.tenantId}'
  and business_id = '${ids.smartGiftBusinessId}'
  and sensitivity = 'PUBLIC'
  and is_active
);

drop policy if exists line_smartgift_binding_read on zuri_core.line_channel_binding;
create policy line_smartgift_binding_read
on zuri_core.line_channel_binding for select
to zuri_line_smartgift_ro
using (
  tenant_id = '${ids.tenantId}'
  and business_id = '${ids.smartGiftBusinessId}'
  and status = 'ACTIVE'
  and valid_from <= now()
  and (expires_at is null or expires_at > now())
);

${importBody}

insert into zuri_core.bootstrap_audit_event (
  id, code, tenant_id, business_id, migration_id, operation, artifact_sha256,
  row_count, correlation_id, details
)
values (
  '${ids.cutoverAuditId}',
  'CUSTOMER-SCOPE-CUTOVER-${ids.missionId}',
  '${ids.tenantId}',
  '${ids.smartGiftBusinessId}',
  '${ids.missionId}',
  'CUSTOMER_SCOPE_CUTOVER',
  '${ids.artifactSha256}',
  74,
  '${ids.batchId}',
  jsonb_build_object(
    'versionId', '${ids.versionId}',
    'approverPersonId', '${ids.approverPersonId}',
    'portfolioId', '${ids.portfolioId}',
    'tenantCode', 'TNT-ETOHGROUP',
    'businessCodes', jsonb_build_array('BUS-SMARTGIFT', 'BUS-ETOH-MUKU', 'BUS-MUJEEN', 'BUS-EMC'),
    'legacyTenantCode', 'TNT-SMARTGIFT',
    'lineBindingStatus', 'PENDING'
  )
)
on conflict (id) do nothing;

insert into supabase_migrations.schema_migrations (version, name)
values ('${ids.migrationVersion}', '${ids.migrationName}')
on conflict (version) do nothing;

commit;
`

const rollback = `-- Rollback for ${ids.missionId}; generated from the verified pre-migration snapshot.
-- Backup SHA-256: ${backup.sha256}; old-row restore payload SHA-256: ${rollbackSha256}
-- This rollback is guarded: it refuses to delete the new Businesses if downstream rows exist.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('zuri:${ids.missionId}'));

do $rollback_guard$
begin
  if exists (
    select 1 from zuri_core.business_knowledge
    where business_id in ('${ids.etohMukuBusinessId}', '${ids.mujeenBusinessId}', '${ids.emcBusinessId}')
  ) then
    raise exception 'rollback refused: downstream knowledge rows exist for a new Business';
  end if;
end
$rollback_guard$;

delete from zuri_core.business_knowledge
where tenant_id = '${ids.tenantId}'
  and business_id = '${ids.smartGiftBusinessId}'
  and bootstrap_batch_id = '${ids.batchId}';

create temporary table zuri_business_knowledge_restore
(like zuri_core.business_knowledge including defaults)
on commit drop;

insert into zuri_business_knowledge_restore (
  knowledge_id, business_id, knowledge_type, product_code, name, category,
  description, unit, sell_price, currency, moq, colors, specification,
  source_ref, source_sha256, as_of, approved_at, is_active, sensitivity,
  contract_version
)
select knowledge_id, business_id, knowledge_type, product_code, name, category,
  description, unit, sell_price, currency, moq, colors, specification,
  source_ref, lower(source_sha256), as_of, approved_at, is_active, sensitivity,
  contract_version
from jsonb_to_recordset(
  convert_from(decode('${oldRowsBase64}', 'base64'), 'UTF8')::jsonb
) as old_rows (
  knowledge_id text, business_id text, knowledge_type text, product_code text,
  name text, category text, description text, unit text,
  sell_price numeric(14, 2), currency text, moq integer, colors text[],
  specification jsonb, source_ref text, source_sha256 text, as_of timestamptz,
  approved_at timestamptz, is_active boolean, sensitivity text,
  contract_version text
);

insert into zuri_core.business_knowledge (
  knowledge_id, tenant_id, business_id, bootstrap_batch_id, knowledge_type,
  product_code, name, category, description, unit, sell_price, currency, moq,
  colors, specification, source_ref, source_sha256, as_of, approved_at,
  is_active, sensitivity, contract_version
)
select knowledge_id, '${ids.tenantId}', '${ids.smartGiftBusinessId}',
  '948076f9-6a0a-43f3-88f5-d7225345ac8a', knowledge_type, product_code, name,
  category, description, unit, sell_price, currency, moq, colors, specification,
  source_ref, source_sha256, as_of, approved_at, is_active, sensitivity,
  contract_version
from zuri_business_knowledge_restore
on conflict (tenant_id, business_id, product_code) do update set
  knowledge_id = excluded.knowledge_id,
  bootstrap_batch_id = excluded.bootstrap_batch_id,
  knowledge_type = excluded.knowledge_type,
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
  sensitivity = excluded.sensitivity,
  contract_version = excluded.contract_version,
  updated_at = now();

update zuri_core.tenant
set portfolio_id = '${ids.oldPortfolioId}',
    code = 'TNT-SMARTGIFT',
    name = 'SmartGift Tenant',
    status = 'ACTIVE',
    updated_at = now(),
    version = version + 1
where id = '${ids.tenantId}';

delete from zuri_core.business
where id in ('${ids.etohMukuBusinessId}', '${ids.mujeenBusinessId}', '${ids.emcBusinessId}');

delete from zuri_core.portfolio
where id = '${ids.portfolioId}'
  and not exists (select 1 from zuri_core.tenant where portfolio_id = '${ids.portfolioId}');

insert into zuri_core.bootstrap_audit_event (
  id, code, tenant_id, business_id, migration_id, operation, artifact_sha256,
  row_count, correlation_id, details
)
values (
  '${ids.rollbackAuditId}',
  'CUSTOMER-SCOPE-ROLLBACK-${ids.missionId}',
  '${ids.tenantId}',
  '${ids.smartGiftBusinessId}',
  '${ids.missionId}',
  'CUSTOMER_SCOPE_CUTOVER_ROLLBACK',
  '${ids.artifactSha256}',
  74,
  '${ids.batchId}',
  jsonb_build_object('backupSha256', '${backup.sha256}', 'versionId', '${ids.versionId}')
)
on conflict (id) do nothing;

commit;
`

fs.writeFileSync(migrationPath, migration, 'utf8')
fs.writeFileSync(rollbackPath, rollback, 'utf8')
console.log(JSON.stringify({
  migrationPath,
  rollbackPath,
  migrationSha256: crypto.createHash('sha256').update(migration, 'utf8').digest('hex'),
  rollbackSha256: crypto.createHash('sha256').update(rollback, 'utf8').digest('hex'),
}))
