import crypto from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

// @req FR-078 — create the named platform approver profile before the
// customer-data import; do not create an organization membership.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.

const migrationVersion = '20260818071000'
const migrationName = 'platform_approver_profile'
const migrationPath = 'supabase/migrations/20260818071000_platform_approver_profile.sql'
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!process.argv.includes('--apply')) {
  console.error('REFUSED: pass --apply to create the reviewed approver profile')
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
           ) as already_applied
  `, [migrationVersion, migrationName])).rows[0]

  if (identity.user !== 'postgres') {
    throw new Error('reviewed approver profile migration requires the postgres connection')
  }

  if (identity.already_applied) {
    console.log(JSON.stringify({
      status: 'ALREADY_APPLIED',
      migrationVersion,
      migrationName,
      migrationSha256,
    }))
    process.exitCode = 0
  } else {
    await client.query(sql)
    console.log(JSON.stringify({
      status: 'APPLIED',
      migrationVersion,
      migrationName,
      migrationSha256,
      personId: 'c82690eb-84e8-48a8-8a28-fe3d839c2276',
      personCode: 'PER-BOSS',
      organizationMembershipCreated: false,
    }))
  }
} catch (error) {
  console.error(`FAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
