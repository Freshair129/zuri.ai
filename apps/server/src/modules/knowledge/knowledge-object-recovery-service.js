// @req FR-173 — qualify exact-version object backup/restore without changing
// application readers or activating Knowledge serving.
// @spec TASK-ZAI-049 §8.1
// @tested tests/unit/knowledge-object-recovery.test.js
import { createHash } from 'node:crypto'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { getS3ObjectStoragePortIdentity } from '@/platform/storage/s3-object-storage'

const SCOPES = ['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility']
const HASH = /^[a-f0-9]{64}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TEST_BUCKET = /^zuri-restore-test-[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function fail(code, message) { throw Object.assign(new Error(message), { code }) }
function canonical(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return fail('KNOWLEDGE_OBJECT_RECOVERY_INVALID_JSON', 'Recovery evidence is not canonical JSON data')
}
function hash(value) { return createHash('sha256').update(value).digest('hex') }
function canonicalHash(value) { return hash(canonical(value)) }
function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('KNOWLEDGE_OBJECT_RECOVERY_INVALID', `${label} is required`)
  return value.trim()
}
function assertUuid(value, label) { if (typeof value !== 'string' || !UUID.test(value)) fail('KNOWLEDGE_OBJECT_RECOVERY_INVALID', `${label} must be a UUID`) }
function assertBinding(binding, label) {
  // Capture once. Later awaits must not re-read a caller-owned descriptor
  // that can swap its otherwise validated port before a copy/readback.
  binding = { id: binding?.id, revision: binding?.revision, endpoint: binding?.endpoint,
    bucket: binding?.bucket, region: binding?.region || 'us-east-1', port: binding?.port }
  required(binding?.id, `${label} binding id`)
  if (!Number.isSafeInteger(binding?.revision) || binding.revision < 1) fail('KNOWLEDGE_OBJECT_RECOVERY_INVALID', `${label} revision is invalid`)
  if (typeof binding.bucket !== 'string' || !TEST_BUCKET.test(binding.bucket) || binding.bucket.length > 63) fail('KNOWLEDGE_OBJECT_RECOVERY_TARGET_DENIED', `${label} must use a TEST recovery bucket`)
  let endpoint
  try { endpoint = new URL(binding.endpoint) } catch { fail('KNOWLEDGE_OBJECT_RECOVERY_TARGET_DENIED', `${label} endpoint is invalid`) }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !LOOPBACK.has(endpoint.hostname.toLowerCase()) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)) {
    fail('KNOWLEDGE_OBJECT_RECOVERY_TARGET_DENIED', `${label} endpoint must be loopback-only`)
  }
  if (typeof binding.port?.readExact !== 'function' || typeof binding.port?.putImmutable !== 'function') fail('KNOWLEDGE_OBJECT_RECOVERY_PORT_UNAVAILABLE', `${label} exact object port is unavailable`)
  const actual = getS3ObjectStoragePortIdentity(binding.port)
  if (!actual || actual.endpoint !== endpoint.href || actual.bucket !== binding.bucket
    || actual.region !== (binding.region || 'us-east-1')) {
    fail('KNOWLEDGE_OBJECT_RECOVERY_PORT_IDENTITY_MISMATCH', `${label} descriptor does not match its factory-owned S3 transport`)
  }
  return Object.freeze(binding)
}
function assertDistinctBuckets(bindings) {
  const buckets = bindings.map(({ bucket }) => bucket)
  if (new Set(buckets).size !== buckets.length) fail('KNOWLEDGE_OBJECT_RECOVERY_TARGET_DENIED', 'Recovery source, backup and target buckets must be distinct')
}
function exactScope(row) {
  const scope = Object.fromEntries(SCOPES.map(key => [key, row?.[key]]))
  for (const [key, value] of Object.entries(scope)) {
    if ((key === 'workspaceId' || key === 'agentId') && value === '') continue
    required(value, `Knowledge scope ${key}`)
  }
  return scope
}
function inventory(snapshot) {
  const rows = snapshot?.tables?.knowledgeArtifactStorage
  const raws = snapshot?.tables?.knowledgeRawArtifact
  if (!Array.isArray(rows) || !Array.isArray(raws)) fail('KNOWLEDGE_OBJECT_RECOVERY_INVENTORY_INVALID', 'Snapshot must include raw and storage inventory tables')
  if (rows.length === 0) fail('KNOWLEDGE_OBJECT_RECOVERY_INVENTORY_INVALID', 'Recovery qualification requires at least one storage reference')
  const rawById = new Map()
  for (const raw of raws) {
    if (!raw || typeof raw.id !== 'string' || rawById.has(raw.id)) fail('KNOWLEDGE_OBJECT_RECOVERY_INVENTORY_INVALID', 'Raw artifact inventory has an invalid or duplicate id')
    rawById.set(raw.id, raw)
  }
  const ids = new Set()
  let commonScope = null
  const entries = rows.map(row => {
    if (!row || typeof row.id !== 'string' || ids.has(row.id)) fail('KNOWLEDGE_OBJECT_RECOVERY_INVENTORY_INVALID', 'Storage inventory has an invalid or duplicate id')
    ids.add(row.id)
    const raw = rawById.get(row.rawArtifactId)
    if (!raw) fail('KNOWLEDGE_OBJECT_RECOVERY_INVENTORY_INVALID', `Storage ${row.id} has no raw artifact`)
    const scope = exactScope(row)
    if (SCOPES.some(key => raw[key] !== scope[key])) fail('KNOWLEDGE_OBJECT_RECOVERY_SCOPE_MISMATCH', `Storage ${row.id} does not match raw scope`)
    if (commonScope && canonical(scope) !== canonical(commonScope)) fail('KNOWLEDGE_OBJECT_RECOVERY_SCOPE_MISMATCH', 'A recovery batch must contain one complete lineage scope')
    commonScope ||= scope
    if (typeof row.bindingId !== 'string' || !row.bindingId.trim() || !Number.isSafeInteger(row.bindingRevision) || row.bindingRevision < 1 || typeof row.bucket !== 'string' || !TEST_BUCKET.test(row.bucket) || row.bucket.length > 63 || typeof row.objectKey !== 'string' || !row.objectKey.trim() || typeof row.contentType !== 'string' || !row.contentType.trim() || !HASH.test(row.sha256 || '') || !Number.isSafeInteger(row.byteLength) || row.byteLength < 0 || String(raw.contentHash).toLowerCase() !== String(row.sha256).toLowerCase()) {
      fail('KNOWLEDGE_OBJECT_RECOVERY_INVENTORY_INVALID', `Storage ${row.id} has incomplete or mismatched hash metadata`)
    }
    if (!['READY', 'ERASED'].includes(row.status)) fail('KNOWLEDGE_OBJECT_RECOVERY_INVENTORY_INVALID', `Storage ${row.id} is not eligible for backup`)
    if (row.status === 'READY' && (typeof row.objectVersionId !== 'string' || !row.objectVersionId.trim())) fail('KNOWLEDGE_OBJECT_RECOVERY_INVENTORY_INVALID', `READY storage ${row.id} has no exact version`)
    return {
      storageId: row.id, rawArtifactId: row.rawArtifactId, scope, sha256: row.sha256.toLowerCase(),
      byteLength: row.byteLength, contentType: row.contentType,
      original: { bindingId: row.bindingId, revision: row.bindingRevision, bucket: row.bucket, key: row.objectKey, versionId: row.objectVersionId || null },
      status: row.status === 'ERASED' ? 'WITHHELD' : 'COPIED',
    }
  }).sort((a, b) => a.storageId.localeCompare(b.storageId))
  return { scope: commonScope, entries }
}
function actualBytes(result, expectedVersion, expectedHash, expectedLength) {
  const bytes = Buffer.isBuffer(result?.bytes) || result?.bytes instanceof Uint8Array ? Buffer.from(result.bytes) : null
  if (!bytes || result.versionId !== expectedVersion || bytes.length !== expectedLength || hash(bytes) !== expectedHash || result.sha256 !== expectedHash || result.byteLength !== expectedLength) {
    fail('KNOWLEDGE_OBJECT_RECOVERY_READBACK_MISMATCH', 'Exact object bytes did not match the pinned hash and length')
  }
  return bytes
}
function assertLedger(ledger, backupId, watermark, entries) {
  if (!ledger || ledger.schemaVersion !== 'knowledge-test-erasure-ledger.v1' || ledger.authority !== 'SYNTHETIC_TEST' || ledger.backupId !== backupId || !Number.isSafeInteger(ledger.watermark) || ledger.watermark < watermark || !Array.isArray(ledger.withheldStorageIds)) {
    fail('KNOWLEDGE_OBJECT_RECOVERY_ERASURE_EVIDENCE_INVALID', 'A current synthetic TEST erasure decision set is required')
  }
  const known = new Set(entries.map(entry => entry.storageId))
  const withheld = new Set(ledger.withheldStorageIds)
  if (withheld.size !== ledger.withheldStorageIds.length || [...withheld].some(id => !known.has(id)) || entries.some(entry => entry.status === 'WITHHELD' && !withheld.has(entry.storageId))) {
    fail('KNOWLEDGE_OBJECT_RECOVERY_ERASURE_EVIDENCE_INVALID', 'Synthetic erasure decisions do not match the snapshot inventory')
  }
  return { withheld, sha256: canonicalHash(ledger) }
}
function operationKey(restoreId, storageId) { return `knowledge-object-restore:${restoreId}:${storageId}` }

export async function createKnowledgeObjectBackup({ snapshot, backupId, sourceRevision, source, backup, erasureWatermark } = {}) {
  assertUuid(backupId, 'backupId')
  if (typeof sourceRevision !== 'string' || !/^[a-f0-9]{40}$/i.test(sourceRevision)) fail('KNOWLEDGE_OBJECT_RECOVERY_INVALID', 'sourceRevision must be a 40-character commit id')
  if (!Number.isSafeInteger(erasureWatermark) || erasureWatermark < 0) fail('KNOWLEDGE_OBJECT_RECOVERY_INVALID', 'erasureWatermark is invalid')
  source = assertBinding(source, 'Source')
  backup = assertBinding(backup, 'Backup')
  assertDistinctBuckets([source, backup])
  const { scope, entries } = inventory(snapshot)
  for (const entry of entries) if (entry.original.bindingId !== source.id || entry.original.revision !== source.revision || entry.original.bucket !== source.bucket) fail('KNOWLEDGE_OBJECT_RECOVERY_SCOPE_MISMATCH', `Storage ${entry.storageId} does not belong to the source binding`)
  for (const entry of entries) {
    if (entry.status === 'WITHHELD') continue
    const sourceBytes = actualBytes(await source.port.readExact({ key: entry.original.key, versionId: entry.original.versionId }), entry.original.versionId, entry.sha256, entry.byteLength)
    const written = await backup.port.putImmutable({ key: entry.original.key, content: sourceBytes, contentType: entry.contentType, expectedSha256: entry.sha256 })
    if (typeof written?.versionId !== 'string' || !written.versionId.trim()) fail('KNOWLEDGE_OBJECT_RECOVERY_VERSION_MISSING', 'Backup provider returned no exact version')
    actualBytes(await backup.port.readExact({ key: entry.original.key, versionId: written.versionId }), written.versionId, entry.sha256, entry.byteLength)
    entry.backup = { bindingId: backup.id, revision: backup.revision, bucket: backup.bucket, key: entry.original.key, versionId: written.versionId }
  }
  const manifest = {
    schemaVersion: 'knowledge-object-backup.v1', backupId, sourceRevision: sourceRevision.toLowerCase(),
    snapshotSha256: canonicalHash(snapshot), erasureWatermark, scope, entries,
  }
  return { manifest, manifestSha256: canonicalHash(manifest) }
}

function validateManifest(snapshot, manifest, manifestSha256, backup) {
  if (!manifest || manifest.schemaVersion !== 'knowledge-object-backup.v1' || !HASH.test(manifestSha256 || '') || canonicalHash(manifest) !== manifestSha256.toLowerCase()) fail('KNOWLEDGE_OBJECT_RECOVERY_MANIFEST_INVALID', 'Backup manifest hash is invalid')
  assertUuid(manifest.backupId, 'manifest backupId')
  if (!/^[a-f0-9]{40}$/i.test(manifest.sourceRevision || '') || !Number.isSafeInteger(manifest.erasureWatermark) || manifest.erasureWatermark < 0 || manifest.snapshotSha256 !== canonicalHash(snapshot)) fail('KNOWLEDGE_OBJECT_RECOVERY_MANIFEST_INVALID', 'Backup manifest does not bind the supplied snapshot')
  const expected = inventory(snapshot)
  if (canonical(manifest.scope) !== canonical(expected.scope) || !Array.isArray(manifest.entries) || manifest.entries.length !== expected.entries.length) fail('KNOWLEDGE_OBJECT_RECOVERY_MANIFEST_INVALID', 'Backup manifest inventory is incomplete')
  for (let i = 0; i < expected.entries.length; i++) {
    const want = expected.entries[i], got = manifest.entries[i]
    for (const key of ['storageId', 'rawArtifactId', 'scope', 'sha256', 'byteLength', 'contentType', 'original', 'status']) if (canonical(got?.[key]) !== canonical(want[key])) fail('KNOWLEDGE_OBJECT_RECOVERY_MANIFEST_INVALID', `Backup manifest changed ${key} for ${want.storageId}`)
    if (want.status === 'WITHHELD') {
      if (got.backup != null) fail('KNOWLEDGE_OBJECT_RECOVERY_MANIFEST_INVALID', `Erased storage ${want.storageId} must not have a backup copy`)
    } else if (!got.backup || got.backup.bindingId !== backup.id || got.backup.revision !== backup.revision || got.backup.bucket !== backup.bucket || got.backup.key !== want.original.key || typeof got.backup.versionId !== 'string' || !got.backup.versionId.trim()) {
      fail('KNOWLEDGE_OBJECT_RECOVERY_MANIFEST_INVALID', `Backup version is missing for ${want.storageId}`)
    }
  }
  return expected
}
async function assertTestDatabaseIdentity(db) {
  if (db?._engineConfig?.activeProvider !== 'postgresql' || typeof db.$queryRawUnsafe !== 'function') fail('KNOWLEDGE_OBJECT_RECOVERY_DATABASE_DENIED', 'Restore requires a TEST-named PostgreSQL database')
  const rows = await db.$queryRawUnsafe('SELECT current_database() AS name')
  if (!/^zuri_knowledge_restore_test_[a-z0-9_-]+$/i.test(rows?.[0]?.name || '')) fail('KNOWLEDGE_OBJECT_RECOVERY_DATABASE_DENIED', 'Database name is not an isolated Knowledge restore TEST target')
}
async function assertTestDatabase(db, snapshot) {
  await assertTestDatabaseIdentity(db)
  if (typeof db.knowledgeArtifactStorage?.findMany !== 'function' || typeof db.knowledgeRawArtifact?.findMany !== 'function') fail('KNOWLEDGE_OBJECT_RECOVERY_DATABASE_DENIED', 'Restore target inventory is unavailable')
  if (typeof db.$transaction !== 'function' || typeof db.auditEvent?.findFirst !== 'function' || typeof db.auditEvent?.findUnique !== 'function' || typeof db.auditEvent?.create !== 'function' || typeof db.knowledgeArtifactOperation?.findUnique !== 'function' || typeof db.knowledgeArtifactOperation?.create !== 'function') fail('KNOWLEDGE_OBJECT_RECOVERY_DATABASE_DENIED', 'Restore audit journal is unavailable')
  const [storageRows, rawRows] = await Promise.all([db.knowledgeArtifactStorage.findMany(), db.knowledgeRawArtifact.findMany()])
  const sorted = rows => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (canonical(sorted(storageRows)) !== canonical(sorted(snapshot.tables.knowledgeArtifactStorage)) || canonical(sorted(rawRows)) !== canonical(sorted(snapshot.tables.knowledgeRawArtifact))) fail('KNOWLEDGE_OBJECT_RECOVERY_DATABASE_MISMATCH', 'TEST database lineage does not exactly match the pinned snapshot')
}

export async function restoreKnowledgeObjectBackup({ snapshot, manifest, manifestSha256, backup, target, db, restoreId, actorId, reason, testErasureLedger } = {}) {
  assertUuid(restoreId, 'restoreId')
  required(actorId, 'actorId'); required(reason, 'reason')
  backup = assertBinding(backup, 'Backup'); target = assertBinding(target, 'Target')
  const expected = validateManifest(snapshot, manifest, manifestSha256, backup)
  const erasure = assertLedger(testErasureLedger, manifest.backupId, manifest.erasureWatermark, expected.entries)
  const originalBuckets = [...new Set(expected.entries.map(entry => entry.original.bucket))]
  assertDistinctBuckets([{ bucket: backup.bucket }, { bucket: target.bucket }, ...originalBuckets.map(bucket => ({ bucket }))])
  await assertTestDatabase(db, snapshot)
  if (typeof db.auditEvent?.findFirst !== 'function') fail('KNOWLEDGE_OBJECT_RECOVERY_DATABASE_DENIED', 'Restore audit collision check is unavailable')
  if (await db.auditEvent.findFirst({ where: { entityType: 'KNOWLEDGE_OBJECT_RESTORE', entityId: restoreId } })) fail('KNOWLEDGE_OBJECT_RECOVERY_COLLISION', 'Restore id already has an audit receipt')
  for (const entry of expected.entries) if (entry.status === 'COPIED' && !erasure.withheld.has(entry.storageId)) {
    const idempotencyKey = operationKey(restoreId, entry.storageId)
    if (await db.knowledgeArtifactOperation.findUnique({ where: { idempotencyKey } })) fail('KNOWLEDGE_OBJECT_RECOVERY_COLLISION', 'Restore operation already exists; reconcile exact versions before retry')
  }
  const entries = []
  for (const entry of manifest.entries) {
    if (entry.status === 'WITHHELD' || erasure.withheld.has(entry.storageId)) {
      entries.push({ ...entry, status: 'WITHHELD', restored: null })
      continue
    }
    const sourceBytes = actualBytes(await backup.port.readExact({ key: entry.backup.key, versionId: entry.backup.versionId }), entry.backup.versionId, entry.sha256, entry.byteLength)
    const written = await target.port.putImmutable({ key: entry.backup.key, content: sourceBytes, contentType: entry.contentType, expectedSha256: entry.sha256 })
    if (typeof written?.versionId !== 'string' || !written.versionId.trim()) fail('KNOWLEDGE_OBJECT_RECOVERY_VERSION_MISSING', 'Restore provider returned no exact version')
    actualBytes(await target.port.readExact({ key: entry.backup.key, versionId: written.versionId }), written.versionId, entry.sha256, entry.byteLength)
    entries.push({ ...entry, status: 'VERIFIED', restored: { bindingId: target.id, revision: target.revision, bucket: target.bucket, key: entry.backup.key, versionId: written.versionId } })
  }
  const receipt = {
    schemaVersion: 'knowledge-object-restore.v1', restoreId, backupId: manifest.backupId,
    manifestSha256: manifestSha256.toLowerCase(), erasureWatermark: testErasureLedger.watermark,
    erasureLedgerSha256: erasure.sha256, scope: expected.scope,
    target: { bindingId: target.id, revision: target.revision, bucket: target.bucket },
    fullAcceptance: false, runtimeActivated: false, servingEnabled: false, entries,
  }
  const evidenceHash = canonicalHash(receipt)
  const auditId = await db.$transaction(async tx => {
    for (const entry of entries.filter(value => value.status === 'VERIFIED')) await tx.knowledgeArtifactOperation.create({
      data: { storageId: entry.storageId, ...expected.scope, idempotencyKey: operationKey(restoreId, entry.storageId), operation: 'RESTORE', status: 'VERIFIED', attempts: 1, actorId, reason, evidenceHash },
    })
    const audit = await recordAudit(tx, {
      entityType: 'KNOWLEDGE_OBJECT_RESTORE', entityId: restoreId, action: 'VERIFIED', actorId,
      tenantId: expected.scope.tenantId, businessId: expected.scope.businessId, reason,
      payload: { receipt, evidenceHash },
    })
    return audit.id
  })
  return { receipt, auditId }
}

export async function verifyRestoredKnowledgeObject({ receipt, auditId, storageId, db, target, testErasureLedger } = {}) {
  required(auditId, 'auditId'); required(storageId, 'storageId')
  target = assertBinding(target, 'Target')
  await assertTestDatabaseIdentity(db)
  const entry = receipt?.entries?.find(value => value.storageId === storageId)
  if (!receipt || receipt.schemaVersion !== 'knowledge-object-restore.v1' || receipt.fullAcceptance !== false || receipt.runtimeActivated !== false || receipt.servingEnabled !== false || !entry || entry.status !== 'VERIFIED' || !entry.restored) fail('KNOWLEDGE_OBJECT_RECOVERY_RECEIPT_INVALID', 'No verified restored reference is present in the receipt')
  const erasure = assertLedger(testErasureLedger, receipt.backupId, receipt.erasureWatermark, receipt.entries)
  if (erasure.withheld.has(storageId)) fail('KNOWLEDGE_OBJECT_RECOVERY_ERASED', 'Current TEST erasure decision withholds this object')
  if (receipt.target.bindingId !== target.id || receipt.target.revision !== target.revision || receipt.target.bucket !== target.bucket || entry.restored.bindingId !== target.id || entry.restored.revision !== target.revision || entry.restored.bucket !== target.bucket || entry.restored.key !== entry.backup?.key || entry.restored.versionId == null) fail('KNOWLEDGE_OBJECT_RECOVERY_TARGET_DENIED', 'Receipt does not name this exact TEST target version')
  const audit = await db.auditEvent.findUnique({ where: { id: auditId } })
  let payload
  try { payload = JSON.parse(audit?.payloadJson || '{}') } catch { fail('KNOWLEDGE_OBJECT_RECOVERY_AUDIT_INVALID', 'Restore audit payload is invalid') }
  if (!audit || audit.entityType !== 'KNOWLEDGE_OBJECT_RESTORE' || audit.entityId !== receipt.restoreId || audit.tenantId !== receipt.scope.tenantId || audit.businessId !== receipt.scope.businessId || canonical(payload.receipt) !== canonical(receipt) || payload.evidenceHash !== canonicalHash(receipt)) fail('KNOWLEDGE_OBJECT_RECOVERY_AUDIT_INVALID', 'Restore audit does not bind this receipt and scope')
  const operation = await db.knowledgeArtifactOperation.findUnique({ where: { idempotencyKey: operationKey(receipt.restoreId, storageId) } })
  if (!operation || operation.storageId !== storageId || SCOPES.some(key => operation[key] !== receipt.scope[key]) || operation.operation !== 'RESTORE' || operation.status !== 'VERIFIED' || operation.evidenceHash !== canonicalHash(receipt)) fail('KNOWLEDGE_OBJECT_RECOVERY_AUDIT_INVALID', 'Restore operation evidence is missing or inconsistent')
  const rows = await db.knowledgeArtifactStorage.findMany()
  const original = rows.find(row => row.id === storageId)
  if (!original || original.status !== 'READY' || original.rawArtifactId !== entry.rawArtifactId || original.bindingId !== entry.original.bindingId || original.bindingRevision !== entry.original.revision || original.objectVersionId !== entry.original.versionId || original.objectKey !== entry.original.key || original.bucket !== entry.original.bucket || original.sha256 !== entry.sha256 || original.byteLength !== entry.byteLength || canonical(exactScope(original)) !== canonical(receipt.scope)) fail('KNOWLEDGE_OBJECT_RECOVERY_DATABASE_MISMATCH', 'Original READY reference changed after restore')
  const rawRows = await db.knowledgeRawArtifact.findMany()
  const raw = rawRows.find(row => row.id === entry.rawArtifactId)
  if (!raw || String(raw.contentHash).toLowerCase() !== entry.sha256 || SCOPES.some(key => raw[key] !== receipt.scope[key])) fail('KNOWLEDGE_OBJECT_RECOVERY_DATABASE_MISMATCH', 'Original raw artifact lineage changed after restore')
  const read = await target.port.readExact({ key: entry.restored.key, versionId: entry.restored.versionId })
  actualBytes(read, entry.restored.versionId, entry.sha256, entry.byteLength)
  return { verified: true, storageId, sha256: entry.sha256, byteLength: entry.byteLength }
}
