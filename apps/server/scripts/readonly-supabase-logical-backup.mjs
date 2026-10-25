import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertOutsideRepository,
  buildHashedArtifact,
  captureDatabaseBaseline,
  sha256,
} from './production-migration-evidence.mjs'
import { createDirectClientConfig, resolveDirectTarget } from './production-migration-target.mjs'

// @req FR-051, FR-071 — preserve a verified rollback snapshot before a
// production identity/data mutation.
// @spec ADR-018 D7/D8 — logical backup precedes bounded migration writes.

const outputPath = process.argv[2]
const connectionString = process.env.DIRECT_URL
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '../../..')

if (!outputPath) throw new Error('READ_ONLY_BACKUP_FAILED: output path is required')
if (!connectionString) throw new Error('READ_ONLY_BACKUP_FAILED: DIRECT_URL is required')

const resolvedOutputPath = assertOutsideRepository(outputPath, REPOSITORY_ROOT)
const dependencyPath = `${resolvedOutputPath}.dependency.ndjson`
if (fs.existsSync(resolvedOutputPath) || fs.existsSync(dependencyPath)) {
  throw new Error('READ_ONLY_BACKUP_FAILED: evidence output path already exists')
}
const target = resolveDirectTarget(connectionString)
const client = new pg.Client({ ...createDirectClientConfig(connectionString), query_timeout: 20_000 })

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
}

const snapshot = {
  schemaVersion: '2.0.0',
  mode: 'READ_ONLY_LOGICAL_BACKUP',
  capturedAt: new Date().toISOString(),
  redactions: ['line_channel_binding.external_channel_id_hash', 'line_channel_binding.credential_hash'],
  tables: {},
}

let dependencyHandle
try {
  await client.connect()
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  dependencyHandle = fs.openSync(dependencyPath, 'wx')
  let rowBuffer = []
  const evidence = await captureDatabaseBaseline(client, target, {
    onDependencyRow: async (rowJson) => {
      rowBuffer.push(`${rowJson}\n`)
      if (rowBuffer.length >= 128) {
        fs.writeSync(dependencyHandle, rowBuffer.join(''), null, 'utf8')
        rowBuffer = []
      }
    },
  })
  if (rowBuffer.length > 0) fs.writeSync(dependencyHandle, rowBuffer.join(''), null, 'utf8')
  fs.fsyncSync(dependencyHandle)
  fs.closeSync(dependencyHandle)
  dependencyHandle = undefined

  for (const [name, sql] of Object.entries(queries)) {
    const result = await client.query(sql)
    snapshot.tables[name] = result.rows
  }
  snapshot.tables.migrations = evidence.migrationHistory
  snapshot.projectRef = target.projectRef
  snapshot.target = evidence.identity
  snapshot.baseline = evidence.baseline
  snapshot.baselineId = evidence.baselineId
  snapshot.dependencyBackup = {
    file: path.basename(dependencyPath),
    rowCount: evidence.baseline.dependency.rowCount,
    sha256: evidence.baseline.dependency.fullRowsSha256,
  }
  await client.query('COMMIT')

  const artifact = buildHashedArtifact(snapshot)
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`
  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true })
  fs.writeFileSync(resolvedOutputPath, serialized, { encoding: 'utf8', flag: 'wx' })
  const dependencySha256 = evidence.baseline.dependency.fullRowsSha256
  console.log(JSON.stringify({
    status: 'VERIFIED_READ_ONLY_SNAPSHOT',
    outputPath: resolvedOutputPath,
    fileSha256: sha256(Buffer.from(serialized, 'utf8')),
    dependencyPath,
    dependencySha256,
    baselineId: evidence.baselineId,
    target: evidence.identity,
    counts: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length])),
  }, null, 2))
} catch (error) {
  if (dependencyHandle !== undefined) fs.closeSync(dependencyHandle)
  await client.query('ROLLBACK').catch(() => {})
  console.error(`READ_ONLY_BACKUP_FAILED: ${error?.code || 'TARGET_OR_QUERY_REJECTED'}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
