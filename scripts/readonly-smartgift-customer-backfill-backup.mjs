import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

// @req FR-078 — preserve a redacted, verified target snapshot before the
// SmartGift Customer Profile batch write.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.

const { Pool } = pg
const outputPath = process.argv[2]
  || 'artifacts/migrations/MIS-SG-CUSTOMER-DATA-BACKFILL-001/customer-backfill-target-backup-before-apply.json'
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
const TENANT_ID = '77cdbe70-3111-4a04-922a-8059be99a8b0'
const BUSINESS_ID = '834fa869-62f3-431c-a287-e9a95e91175b'
const CONTRACT_ID = 'CDC-SG-CUSTOMER-DATA-001'
const MISSION_ID = 'MIS-SG-CUSTOMER-DATA-BACKFILL-001'
const VERSION_ID = 'VER-SG-CUSTOMER-DATA-CONTRACT-0.2.0B'

if (!connectionString) {
  console.error('SMARTGIFT_BACKUP_FAILED: database environment is required')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  max: 1,
  connectionTimeoutMillis: 10_000,
  query_timeout: 20_000,
})

const tableQueries = {
  person: `select id, code, display_name, email, created_at, updated_at from zuri_core.person order by id`,
  customer: `select id, code, tenant_id, business_id, person_id, display_name, lifecycle_stage, created_at, updated_at, deleted_at, version from zuri_core.customer order by id`,
  customer_import_batch: `select id, contract_id, mission_id, version_id, tenant_id, business_id, source_ref, snapshot_sha256, source_row_count, publish_row_count, held_row_count, status, approved_by_person_id, created_at, updated_at from zuri_core.customer_import_batch order by id`,
  customer_import_provenance: `select id, batch_id, source_system, source_table, source_record_key, source_row, source_sha256, snapshot_sha256, idempotency_key, resolution_status, match_method, disposition, person_id, customer_id, created_at, updated_at from zuri_core.customer_import_provenance order by id`,
}

function canonical(value) {
  return JSON.stringify(value, Object.keys(value).sort())
}

function digestRows(rows) {
  const digest = crypto.createHash('sha256')
  for (const row of rows) digest.update(`${canonical(row)}\n`, 'utf8')
  return digest.digest('hex')
}

try {
  const snapshot = {
    schemaVersion: '1.0.0',
    mode: 'READ_ONLY_REDACTED_TARGET_BACKUP',
    contractId: CONTRACT_ID,
    missionId: MISSION_ID,
    versionId: VERSION_ID,
    scope: { tenantId: TENANT_ID, businessId: BUSINESS_ID },
    capturedAt: new Date().toISOString(),
    rawPiiStored: false,
    tables: {},
    scopeCounts: {},
  }

  for (const [table, sql] of Object.entries(tableQueries)) {
    const result = await pool.query(sql)
    snapshot.tables[table] = {
      rowCount: result.rowCount,
      rowSha256: digestRows(result.rows),
    }
  }

  const scoped = await pool.query(
    `select
       (select count(*)::int from zuri_core.customer where tenant_id = $1 and business_id = $2) as customer_rows,
       (select count(*)::int from zuri_core.customer_import_batch where tenant_id = $1 and business_id = $2) as batch_rows,
       (select count(*)::int from zuri_core.customer_import_provenance p
          join zuri_core.customer_import_batch b on b.id = p.batch_id
         where b.tenant_id = $1 and b.business_id = $2) as provenance_rows,
       (select count(*)::int from zuri_core.person where code = 'PER-BOSS') as platform_owner_profiles`,
    [TENANT_ID, BUSINESS_ID],
  )
  snapshot.scopeCounts = scoped.rows[0]

  const canonicalSnapshot = JSON.stringify(snapshot)
  snapshot.sha256 = crypto.createHash('sha256').update(canonicalSnapshot, 'utf8').digest('hex')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    status: 'VERIFIED_READ_ONLY_TARGET_BACKUP',
    outputPath,
    sha256: snapshot.sha256,
    tableCounts: Object.fromEntries(Object.entries(snapshot.tables).map(([name, value]) => [name, value.rowCount])),
    scopeCounts: snapshot.scopeCounts,
    rawPiiStored: false,
  }))
} finally {
  await pool.end()
}
