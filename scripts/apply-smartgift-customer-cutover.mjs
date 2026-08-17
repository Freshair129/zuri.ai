import crypto from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

// @req FR-051, FR-071 — apply the approved SmartGift customer-scope migration
// only after the reviewed transaction smoke has passed.
// @spec ADR-018 D7/D8, PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.

const migrationPath = 'supabase/migrations/20260818060000_customer_wannapa_identity_and_smartgift_cutover.sql'
const migrationVersion = '20260818060000'
const migrationName = 'customer_wannapa_identity_and_smartgift_cutover'
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!process.argv.includes('--apply')) {
  console.error('REFUSED: pass --apply to execute the reviewed migration')
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
  const identity = await client.query(`
    select current_user as user,
           current_database() as database,
           exists (
             select 1
             from supabase_migrations.schema_migrations
             where version = $1
                or (version = $1 and name = $2)
           ) as already_applied
  `, [migrationVersion, migrationName])

  const row = identity.rows[0]
  if (row.user !== 'postgres') {
    throw new Error('reviewed migration requires the reviewed admin connection')
  }
  if (row.already_applied) {
    console.log(JSON.stringify({
      status: 'ALREADY_APPLIED',
      migrationVersion,
      migrationName,
      migrationSha256,
    }))
    process.exit(0)
  }

  await client.query(sql)
  console.log(JSON.stringify({
    status: 'APPLIED',
    migrationVersion,
    migrationName,
    migrationSha256,
  }))
} catch (error) {
  console.error(JSON.stringify({
    status: 'FAILED',
    code: error?.code || 'UNKNOWN',
    migrationVersion,
    migrationName,
  }))
  process.exitCode = 1
} finally {
  await client.end()
}
