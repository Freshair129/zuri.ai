import crypto from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

// @req FR-078 — apply the private Person/Customer/provenance target schema
// before any customer profile backfill.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.

const migrationVersion = '20260818070000'
const migrationName = 'customer_profile_backfill_schema'
const migrationPath = 'supabase/migrations/20260818070000_customer_profile_backfill_schema.sql'
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!process.argv.includes('--apply')) {
  console.error('REFUSED: pass --apply to execute the reviewed target-schema migration')
  process.exit(2)
}

if (!connectionString) {
  console.error('FAILED: missing database connection environment')
  process.exit(1)
}

const sql = fs.readFileSync(migrationPath, 'utf8')
const migrationSha256 = crypto.createHash('sha256').update(sql, 'utf8').digest('hex')
const client = new pg.Client({
  connectionString,
  ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  connectionTimeoutMillis: 10_000,
})

try {
  await client.connect()
  const identity = (await client.query(`
    select current_user as user,
           exists (
             select 1
             from supabase_migrations.schema_migrations
             where version = $1 and name = $2
           ) as already_applied,
           to_regclass('zuri_core.customer') is not null as customer_exists,
           to_regclass('zuri_core.customer_import_provenance') is not null as provenance_exists
  `, [migrationVersion, migrationName])).rows[0]

  if (identity.user !== 'postgres') {
    throw new Error('reviewed target-schema migration requires the postgres connection')
  }

  if (identity.already_applied) {
    console.log(JSON.stringify({
      status: 'ALREADY_APPLIED',
      migrationVersion,
      migrationName,
      migrationSha256,
    }))
    process.exit(0)
  }

  if (identity.customer_exists || identity.provenance_exists) {
    throw new Error('target schema objects exist without the reviewed migration receipt')
  }

  await client.query(sql)
  await client.query(`
    insert into supabase_migrations.schema_migrations (version, name)
    values ($1, $2)
    on conflict (version) do nothing
  `, [migrationVersion, migrationName])

  console.log(JSON.stringify({
    status: 'APPLIED',
    migrationVersion,
    migrationName,
    migrationSha256,
    tables: ['person', 'customer', 'customer_import_batch', 'customer_import_provenance'],
    customerRowsWritten: 0,
  }))
} catch (error) {
  console.error(`FAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
