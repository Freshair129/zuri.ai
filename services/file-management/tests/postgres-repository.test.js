// @spec ADR-107 - repository transaction sequence proof.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPostgresFileRepository } from '../src/postgres-repository.js'

const operation = {
  id: '40000000-0000-4000-8000-000000000001',
  correlation_id: '70000000-0000-4000-8000-000000000001',
  file_id: '50000000-0000-4000-8000-000000000001',
  version_id: '60000000-0000-4000-8000-000000000001',
  tenant_id: '10000000-0000-4000-8000-000000000001',
  business_id: '20000000-0000-4000-8000-000000000002',
  actor_id: '30000000-0000-4000-8000-000000000001',
  operation_type: 'CREATE',
  idempotency_key: 'postgres-fixture-1',
  request_sha256: 'a'.repeat(64),
  status: 'PENDING',
  storage_provider: 'S3_COMPATIBLE',
  storage_binding_id: 'fixture-storage-a',
  storage_bucket: 'private-files',
  file_name: 'catalog.csv',
  declared_content_type: 'text/csv',
  byte_length: 5,
  sha256: 'b'.repeat(64),
  provenance_json: { kind: 'BROWSER_UPLOAD' },
  result_json: null,
}

test('PostgreSQL commit writes version, audit and outbox before committing the receipt transaction', async () => {
  const calls = []
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (sql === 'SELECT * FROM zuri_files.file_operation WHERE id=$1 FOR UPDATE') return { rows: [operation] }
      if (sql.includes('SELECT id, tenant_id, business_id, status, deleted_at')) return { rows: [{ id: operation.file_id, tenant_id: operation.tenant_id, business_id: operation.business_id, status: 'ACTIVE', deleted_at: null }] }
      if (sql.startsWith('SELECT COALESCE(MAX(version_number)')) return { rows: [{ next_number: 1 }] }
      return { rows: [] }
    },
    release() {},
  }
  const pool = { async connect() { return client }, async end() {} }
  const repository = createPostgresFileRepository(pool)
  const stored = { provider: 'S3_COMPATIBLE', bindingId: 'fixture-storage-a', bucket: 'private-files', key: 'originals/t/b/f/op', versionId: 'provider-v1' }
  const result = await repository.commitOperation({ operation: { operationId: operation.id }, stored, now: new Date('2026-09-24T00:00:00Z') })

  const sql = calls.map((call) => call.sql)
  assert.equal(sql[0], 'BEGIN')
  assert.equal(sql.at(-1), 'COMMIT')
  assert.ok(sql.findIndex((query) => query.includes('INSERT INTO zuri_files.file_version')) < sql.findIndex((query) => query.includes('INSERT INTO zuri_files.file_outbox_event')))
  assert.ok(sql.findIndex((query) => query.includes('INSERT INTO zuri_files.file_outbox_event')) < sql.findIndex((query) => query.includes("UPDATE zuri_files.file_operation SET status='COMMITTED'")))

  const versionInsert = calls.find((call) => call.sql.includes('INSERT INTO zuri_files.file_version'))
  assert.deepEqual(versionInsert.params.slice(7, 12), ['S3_COMPATIBLE', 'fixture-storage-a', 'private-files', stored.key, stored.versionId])
  const outboxInsert = calls.find((call) => call.sql.includes('INSERT INTO zuri_files.file_outbox_event'))
  assert.equal(outboxInsert.params[0], operation.id)
  assert.deepEqual(JSON.parse(outboxInsert.params[6]), {
    correlationId: operation.correlation_id,
    fileId: operation.file_id,
    versionId: operation.version_id,
    versionNumber: 1,
    sha256: operation.sha256,
    byteLength: operation.byte_length,
    safetyState: 'UNSCANNED',
  })
  assert.equal(result.status, 'STORED')
})

test('PostgreSQL operation intent records the exact storage binding identity', async () => {
  let insert
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] }
      if (sql.includes('INSERT INTO zuri_files.file_operation')) {
        insert = { sql, params }
        return { rows: [operation] }
      }
      return { rows: [] }
    },
    release() {},
  }
  const repository = createPostgresFileRepository({ async connect() { return client }, async end() {} })
  const result = await repository.beginOperation({
    operationId: operation.id,
    correlationId: operation.correlation_id,
    fileId: operation.file_id,
    versionId: operation.version_id,
    tenantId: operation.tenant_id,
    businessId: operation.business_id,
    actorId: operation.actor_id,
    operationType: 'CREATE',
    idempotencyKey: operation.idempotency_key,
    requestDigest: operation.request_sha256,
    storageProvider: 'S3_COMPATIBLE',
    storageBindingId: 'fixture-storage-a',
    storageBucket: 'private-files',
    fileName: operation.file_name,
    contentType: operation.declared_content_type,
    byteLength: operation.byte_length,
    sha256: operation.sha256,
    provenance: operation.provenance_json,
    createdAt: new Date('2026-09-24T00:00:00Z'),
  })

  assert.equal(insert.params.length, 19)
  assert.equal(insert.params[11], 'fixture-storage-a')
  assert.match(insert.sql, /storage_provider, storage_binding_id, storage_bucket/)
  assert.equal(result.storageBindingId, 'fixture-storage-a')
})
