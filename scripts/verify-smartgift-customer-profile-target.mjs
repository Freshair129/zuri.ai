import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

// @req FR-078 — prove the private SmartGift Customer target, scope, approver
// profile and RLS boundary before customer rows are eligible for import.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
const outputPath = process.argv[2]
  || 'artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-profile-target-verification.json'
const expected = {
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  tenantCode: 'TNT-ETOHGROUP',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  businessCode: 'BUS-SMARTGIFT',
  approverPersonId: 'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  approverCode: 'PER-BOSS',
  targetSchemaMigration: '20260818070000',
  profileMigration: '20260818071000',
  contractReceiptMigration: '20260818072000',
  tables: ['person', 'customer', 'customer_import_batch', 'customer_import_provenance'],
}

if (!connectionString) {
  console.error('FAILED: missing database connection environment')
  process.exit(1)
}

const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10_000,
})
const report = {
  mode: 'READ_ONLY_TARGET_VERIFICATION',
  generatedAt: new Date().toISOString(),
  expected,
  checks: {},
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function query(name, text, values = []) {
  const result = await client.query(text, values)
  report.checks[name] = result.rows
  return result.rows
}

try {
  await client.connect()
  const connection = (await query('connection', 'select current_database() as database, current_user as user'))[0]
  assert(connection.user === 'postgres', 'target verification requires the reviewed postgres connection')

  const scope = (await query('scope', `
    select t.id as tenant_id, t.code as tenant_code,
           b.id as business_id, b.code as business_code
    from zuri_core.tenant t
    join zuri_core.business b on b.tenant_id = t.id
    where t.id = $1 and b.id = $2
  `, [expected.tenantId, expected.businessId]))[0]
  assert(scope, 'SmartGift target scope is missing')
  assert(scope.tenant_code === expected.tenantCode, 'tenant code mismatch')
  assert(scope.business_code === expected.businessCode, 'business code mismatch')

  const migrations = await query('migrationHistory', `
    select version, name
    from supabase_migrations.schema_migrations
    where version in ($1, $2, $3)
    order by version
  `, [expected.targetSchemaMigration, expected.profileMigration, expected.contractReceiptMigration])
  assert(migrations.length === 3, 'customer target migration history is incomplete')

  const tables = []
  for (const table of expected.tables) {
    const row = (await query(`table:${table}`, `
      select c.relname as table,
             c.relrowsecurity as row_security,
             c.relforcerowsecurity as force_row_security,
             (select count(*)::int from zuri_core.${table}) as row_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'zuri_core' and c.relname = $1
    `, [table]))[0]
    assert(row, `target table is missing: ${table}`)
    assert(row.row_security && row.force_row_security, `RLS is not forced: ${table}`)
    tables.push({ table, rowCount: row.row_count, rowSecurity: row.row_security, forceRowSecurity: row.force_row_security })
  }

  const forbiddenGrants = await query('forbiddenGrants', `
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'zuri_core'
      and table_name = any($1)
      and grantee in ('anon', 'authenticated', 'service_role')
    order by grantee, table_name, privilege_type
  `, [expected.tables])
  assert(forbiddenGrants.length === 0, 'Data API roles have access to the private target')

  const approver = (await query('approverProfile', `
    select id, code, display_name, (email is not null) as email_present
    from zuri_core.person
    where id = $1 and code = $2
  `, [expected.approverPersonId, expected.approverCode]))[0]
  assert(approver, 'platform approver profile is missing')

  const customerCounts = (await query('customerCounts', `
    select
      (select count(*)::int from zuri_core.customer) as customer_rows,
      (select count(*)::int from zuri_core.customer_import_batch) as batch_rows,
      (select count(*)::int from zuri_core.customer_import_provenance) as provenance_rows
  `))[0]
  assert(customerCounts.customer_rows === 0, 'customer rows were written before approval')
  assert(customerCounts.batch_rows === 0 && customerCounts.provenance_rows === 0, 'import ledger rows were written before approval')

  const receipt = (await query('contractReceipt', `
    select code, row_count, details
    from zuri_core.bootstrap_audit_event
    where code = $1
  `, ['CUSTOMER-TARGET-SCHEMA-CONTRACT-RECEIPT-CDC-SG-CUSTOMER-DATA-001']))[0]
  assert(receipt, 'current contract-version receipt is missing')
  assert(receipt.details?.contractVersion === 'VER-SG-CUSTOMER-DATA-CONTRACT-0.2.0B', 'contract receipt version mismatch')
  assert(receipt.details?.customerRowsWritten === 0, 'contract receipt reports customer rows')

  report.checks.tables = tables
  report.status = 'VERIFIED'
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    status: report.status,
    tenantId: expected.tenantId,
    businessId: expected.businessId,
    approverPersonId: expected.approverPersonId,
    migrations: migrations.length,
    tables: tables.map((row) => ({ table: row.table, rowCount: row.rowCount, forceRowSecurity: row.forceRowSecurity })),
    customerRowsWritten: 0,
    output: outputPath,
  }))
} catch (error) {
  report.status = 'FAILED'
  report.failureCode = error?.code || 'ASSERTION_FAILED'
  console.error(JSON.stringify({ status: report.status, code: report.failureCode }))
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
