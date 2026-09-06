import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

// @req FR-051, FR-071 — prove the SmartGift customer-scope migration against
// the live destination without returning product descriptions or credentials.
// @spec ADR-018 D7/D8, PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.

const { Client } = pg
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
const outputPath = process.argv[2] || null
const expected = {
  portfolioId: '5c621811-7e7a-42dd-ac39-ea9e8416ba98',
  portfolioCode: 'PF-WANNAPA-WORKSPACE',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  tenantCode: 'TNT-ETOHGROUP',
  businessIds: {
    'BUS-SMARTGIFT': '834fa869-62f3-431c-a287-e9a95e91175b',
    'BUS-ETOH-MUKU': 'ad6627eb-cc3c-4465-8d55-10ef68786fa3',
    'BUS-MUJEEN': 'dc84f828-df37-4417-84e0-63b863bedb34',
    'BUS-EMC': '161c1acf-7c0a-44bc-875c-39bee1628685',
  },
  batchId: '32a14e35-8896-45b5-b949-4ca1dda24620',
  missionId: 'MIS-SG-CUSTOMER-DATA-MIGRATION-001',
  versionId: 'VER-SG-DATA-MIGRATION-0.2.0B',
  approverPersonId: 'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  artifactSha256: '769d6f83743656591ff095f945f3f32aa8d8b9702dfc5cbb4184011260082717',
  sourceSha256: '017e72b6748d5f3ad99d2c85da0d3df71cf0e7e3d66fe79e67591066f2788c76',
  migrationVersion: '20260818060000',
  migrationName: 'customer_wannapa_identity_and_smartgift_cutover',
  lineBindingCode: 'LINE-SMARTGIFT-OA',
}

if (!connectionString) {
  console.error('FAILED: missing database connection environment')
  process.exit(1)
}

const client = new Client({
  connectionString,
  ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10_000,
})

const report = {
  mode: 'READ_ONLY_POSTFLIGHT',
  generatedAt: new Date().toISOString(),
  expected,
  checks: {},
}

async function query(name, sql, values = []) {
  const result = await client.query(sql, values)
  report.checks[name] = result.rows
  return result.rows
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  await client.connect()
  const identity = (await query('connection', `
    select current_database() as database, current_user as user
  `))[0]
  assert(identity.user === 'postgres', 'postflight requires the reviewed admin connection')

  const portfolios = await query('portfolio', `
    select id, code, name, status
    from zuri_core.portfolio
    where id = $1
  `, [expected.portfolioId])
  assert(portfolios.length === 1, 'customer portfolio is missing')
  assert(portfolios[0].code === expected.portfolioCode, 'customer portfolio code mismatch')

  const tenants = await query('tenant', `
    select id, portfolio_id, code, name, status
    from zuri_core.tenant
    where id = $1
  `, [expected.tenantId])
  assert(tenants.length === 1, 'customer tenant is missing')
  assert(tenants[0].portfolio_id === expected.portfolioId, 'tenant portfolio mismatch')
  assert(tenants[0].code === expected.tenantCode, 'customer tenant code mismatch')

  const businesses = await query('businesses', `
    select id, tenant_id, code, name, status
    from zuri_core.business
    where tenant_id = $1
    order by code
  `, [expected.tenantId])
  assert(businesses.length === Object.keys(expected.businessIds).length, 'customer business count mismatch')
  for (const business of businesses) {
    assert(expected.businessIds[business.code] === business.id, `business identity mismatch for ${business.code}`)
    assert(business.status === 'ACTIVE', `business is not active: ${business.code}`)
  }

  const knowledge = (await query('knowledge', `
    select count(*)::int as rows,
           count(distinct product_code)::int as distinct_product_codes,
           count(*) filter (where sell_price is not null)::int as priced_rows,
           count(*) filter (where currency is not null)::int as currency_rows,
           count(*) filter (where sensitivity <> 'PUBLIC')::int as non_public_rows,
           count(*) filter (where source_sha256 <> $3)::int as source_mismatch_rows,
           count(*) filter (where bootstrap_batch_id <> $4)::int as batch_mismatch_rows,
           min(source_sha256) as min_source_sha256,
           max(source_sha256) as max_source_sha256
    from zuri_core.business_knowledge
    where tenant_id = $1 and business_id = $2
  `, [expected.tenantId, expected.businessIds['BUS-SMARTGIFT'], expected.sourceSha256, expected.batchId]))[0]
  assert(knowledge.rows === 74, 'SmartGift knowledge row count mismatch')
  assert(knowledge.distinct_product_codes === 74, 'SmartGift product code uniqueness mismatch')
  assert(knowledge.priced_rows === 0 && knowledge.currency_rows === 0, 'commercial fields leaked into import')
  assert(knowledge.non_public_rows === 0, 'non-public knowledge leaked into import')
  assert(knowledge.source_mismatch_rows === 0, 'source hash mismatch in imported knowledge')
  assert(knowledge.batch_mismatch_rows === 0, 'bootstrap batch mismatch in imported knowledge')

  const cutoverAudit = (await query('cutover_audit', `
    select id, code, tenant_id, business_id, migration_id, operation,
           artifact_sha256, row_count, correlation_id, details
    from zuri_core.bootstrap_audit_event
    where id = '4a06e228-e85c-44a2-af55-3562756ce31e'
  `))[0]
  assert(cutoverAudit, 'customer cutover audit event is missing')
  assert(cutoverAudit.tenant_id === expected.tenantId, 'cutover audit tenant mismatch')
  assert(cutoverAudit.business_id === expected.businessIds['BUS-SMARTGIFT'], 'cutover audit business mismatch')
  assert(cutoverAudit.migration_id === expected.missionId, 'cutover audit mission mismatch')
  assert(cutoverAudit.operation === 'CUSTOMER_SCOPE_CUTOVER', 'cutover audit operation mismatch')
  assert(cutoverAudit.artifact_sha256 === expected.artifactSha256, 'cutover audit artifact mismatch')
  assert(cutoverAudit.row_count === 74, 'cutover audit row count mismatch')
  assert(cutoverAudit.correlation_id === expected.batchId, 'cutover audit batch mismatch')
  assert(cutoverAudit.details?.versionId === expected.versionId, 'cutover audit version mismatch')
  assert(cutoverAudit.details?.approverPersonId === expected.approverPersonId, 'cutover audit approver mismatch')

  const lineBinding = (await query('line_binding', `
    select id, code, tenant_id, business_id, status,
           external_channel_id_hash, credential_hash
    from zuri_core.line_channel_binding
    where code = $1
  `, [expected.lineBindingCode]))[0]
  assert(lineBinding, 'LINE binding is missing')
  assert(lineBinding.tenant_id === expected.tenantId, 'LINE binding tenant mismatch')
  assert(lineBinding.business_id === expected.businessIds['BUS-SMARTGIFT'], 'LINE binding business mismatch')
  assert(lineBinding.status === 'PENDING', 'LINE binding was activated unexpectedly')
  assert(lineBinding.external_channel_id_hash === null && lineBinding.credential_hash === null, 'LINE credentials changed unexpectedly')

  const rls = await query('rls', `
    select c.relname as table, c.relrowsecurity as rowsecurity,
           c.relforcerowsecurity as forcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'zuri_core'
      and c.relname in ('business_knowledge', 'line_channel_binding')
    order by c.relname
  `)
  assert(rls.length === 2 && rls.every((row) => row.rowsecurity && row.forcerowsecurity), 'RLS is not forced on customer read surfaces')

  const policies = await query('policies', `
    select tablename, policyname, roles, cmd, qual
    from pg_policies
    where schemaname = 'zuri_core'
      and policyname in ('line_smartgift_knowledge_read', 'line_smartgift_binding_read')
    order by policyname
  `)
  assert(policies.length === 2, 'customer RLS policies are incomplete')
  for (const policy of policies) {
    assert(policy.qual.includes(expected.tenantId) && policy.qual.includes(expected.businessIds['BUS-SMARTGIFT']), `RLS scope mismatch for ${policy.policyname}`)
  }

  const oldPortfolioTenantCount = (await query('old_portfolio', `
    select count(*)::int as tenant_count
    from zuri_core.tenant
    where portfolio_id = 'dfeaa9d2-7c65-48bc-9c30-ba083eac8439'
  `))[0]
  assert(oldPortfolioTenantCount.tenant_count === 0, 'legacy platform portfolio still owns the customer tenant')

  const migrationHistory = (await query('migration_history', `
    select version, name
    from supabase_migrations.schema_migrations
    where version = $1
  `, [expected.migrationVersion]))[0]
  assert(migrationHistory && migrationHistory.name === expected.migrationName, 'Supabase migration history is missing the applied migration')

  report.status = 'VERIFIED'
  const serialized = JSON.stringify(report, null, 2) + '\n'
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, serialized, 'utf8')
  }
  console.log(JSON.stringify({
    status: report.status,
    tenantId: expected.tenantId,
    tenantCode: expected.tenantCode,
    businessCount: businesses.length,
    smartGiftBusinessId: expected.businessIds['BUS-SMARTGIFT'],
    knowledgeRows: knowledge.rows,
    missionId: expected.missionId,
    versionId: expected.versionId,
    approverPersonId: expected.approverPersonId,
    lineBindingStatus: lineBinding.status,
    migrationVersion: expected.migrationVersion,
  }))
} catch (error) {
  report.status = 'FAILED'
  report.failureCode = error?.code || 'ASSERTION_FAILED'
  console.error(JSON.stringify({ status: report.status, code: report.failureCode }))
  process.exitCode = 1
} finally {
  await client.end()
}
