import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

// @req FR-051, FR-071 — preserve a verified rollback snapshot before a
// production identity/data mutation.
// @spec ADR-018 D7/D8 — logical backup precedes bounded migration writes.

const { Pool } = pg
const outputPath = process.argv[2]
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!outputPath || !connectionString) {
  console.error('READ_ONLY_BACKUP_FAILED: output path and database environment are required')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  max: 1,
  connectionTimeoutMillis: 10_000,
  query_timeout: 20_000,
})

const queries = {
  portfolio: `select id, code, name, status, created_at, updated_at, version from zuri_core.portfolio order by id`,
  tenant: `select id, portfolio_id, code, name, status, created_at, updated_at, version from zuri_core.tenant order by id`,
  business: `select id, tenant_id, code, name, status, created_at, updated_at, version from zuri_core.business order by id`,
  businessKnowledge: `select knowledge_id, tenant_id, business_id, bootstrap_batch_id,
    knowledge_type, product_code, name, category, description, unit, sell_price, currency,
    moq, colors, specification, source_ref, source_sha256, as_of, approved_at,
    is_active, sensitivity, contract_version, created_at, updated_at
    from zuri_core.business_knowledge order by tenant_id, business_id, product_code`,
  bootstrapAuditEvent: `select id, code, tenant_id, business_id, migration_id, operation,
    artifact_sha256, row_count, correlation_id, occurred_at, details
    from zuri_core.bootstrap_audit_event order by occurred_at, id`,
  lineChannelBinding: `select id, code, provider, tenant_id, business_id, status,
    valid_from, expires_at, rotated_at, created_at, updated_at, version
    from zuri_core.line_channel_binding order by id`,
  migrations: `select version, name from supabase_migrations.schema_migrations order by version`,
}

const snapshot = {
  schemaVersion: '1.0.0',
  mode: 'READ_ONLY_LOGICAL_BACKUP',
  projectRef: 'qcnmhyglarzcpudjorzc',
  capturedAt: new Date().toISOString(),
  redactions: ['line_channel_binding.external_channel_id_hash', 'line_channel_binding.credential_hash'],
  tables: {},
}

try {
  for (const [name, sql] of Object.entries(queries)) {
    const result = await pool.query(sql)
    snapshot.tables[name] = result.rows
  }
  const canonical = JSON.stringify(snapshot)
  snapshot.sha256 = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({
    status: 'VERIFIED_READ_ONLY_SNAPSHOT',
    outputPath,
    sha256: snapshot.sha256,
    counts: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length])),
  }))
} finally {
  await pool.end()
}
