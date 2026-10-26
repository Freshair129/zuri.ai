// @req FR-173 — offline recovery copies and verifies exact object versions.
// @spec TASK-ZAI-049 §8.1
// @tested src/modules/knowledge/knowledge-object-recovery-service.js
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createS3ObjectStoragePort, getS3ObjectStoragePortIdentity } from '@/platform/storage/s3-object-storage'
import {
  createKnowledgeObjectBackup,
  restoreKnowledgeObjectBackup,
  verifyRestoredKnowledgeObject,
} from '@/modules/knowledge/knowledge-object-recovery-service'

const bytes = Buffer.from([0, 65, 128, 255, 10])
const textSentinel = 'INLINE_CONTENT_MUST_NOT_ENTER_THE_RECEIPT'
const digest = (value) => createHash('sha256').update(value).digest('hex')
const objectHash = digest(bytes)
const scope = {
  portfolioId: 'portfolio-test', tenantId: 'tenant-test', businessId: 'business-test',
  workspaceId: 'workspace-test', agentId: 'agent-test', visibility: 'PRIVATE',
}
const sourceBucket = 'zuri-restore-test-source'
const backupBucket = 'zuri-restore-test-backup'
const targetBucket = 'zuri-restore-test-target'
const backupId = '11111111-1111-4111-8111-111111111111'
const restoreId = '22222222-2222-4222-8222-222222222222'
const sourceRevision = 'a'.repeat(40)

function canonical(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value)
}

function artifact(id, extraScope = {}) {
  return {
    id, rawExternalRecordId: `external-${id}`, sourceId: `source-${id}`,
    documentId: `document-${id}`, version: 'source-v1', contentHash: objectHash,
    content: textSentinel, sourceType: 'FILE_AS_TEXT', sourceUri: null,
    contentType: 'application/octet-stream', pipelineVersion: 'test-pipeline-v1',
    schemaVersion: 'test-schema-v1', ...scope, ...extraScope,
    receivedAt: new Date('2026-10-26T00:00:00.000Z'),
    createdAt: new Date('2026-10-26T00:00:00.000Z'),
  }
}

function storage(id, rawArtifactId = `raw-${id}`, overrides = {}) {
  const businessId = overrides.businessId || scope.businessId
  return {
    id, rawArtifactId, ...scope, ...overrides,
    bindingId: 'source-binding', bindingRevision: 1, bucket: sourceBucket,
    objectKey: `knowledge/raw/${scope.tenantId}/${businessId}/${rawArtifactId}/${objectHash}`,
    objectVersionId: `source-${id}-v1`, sha256: objectHash, byteLength: bytes.length,
    contentType: 'application/octet-stream', policyJson: '{"classification":"TEST"}',
    retentionUntil: null, status: 'READY', version: 1,
    createdAt: new Date('2026-10-26T00:00:00.000Z'),
    updatedAt: new Date('2026-10-26T00:00:00.000Z'),
    ...overrides,
  }
}

function snapshot(rows = [storage('storage-1')]) {
  return {
    schemaVersion: 'test-snapshot-v1', exportedAt: '2026-10-26T00:00:00.000Z',
    tables: {
      knowledgeRawArtifact: rows.map(row => artifact(row.rawArtifactId, {
        ...Object.fromEntries(Object.keys(scope).map(k => [k, row[k]])),
      })),
      knowledgeArtifactStorage: rows,
    },
  }
}

function port(name, events, { corruptReadback = false } = {}) {
  const objects = new Map()
  let writes = 0
  const id = (key, version) => `${key}\u0000${version}`
  const memory = {
    seed(key, version, content = bytes) {
      const data = Buffer.from(content)
      objects.set(id(key, version), { data, sha256: digest(data), byteLength: data.length })
    },
    putImmutable: vi.fn(async ({ key, content, expectedSha256 }) => {
      const data = Buffer.from(content)
      const sha256 = digest(data)
      events.push(`${name}:put:${key}`)
      if (expectedSha256 && expectedSha256 !== sha256) throw new Error('synthetic hash mismatch')
      const versionId = `${name}-v${++writes}`
      objects.set(id(key, versionId), { data, sha256, byteLength: data.length })
      return { key, versionId, sha256, byteLength: data.length }
    }),
    readExact: vi.fn(async ({ key, versionId }) => {
      events.push(`${name}:read:${key}:${versionId}`)
      const stored = objects.get(id(key, versionId))
      if (!stored) throw Object.assign(new Error('synthetic exact version missing'), { code: 'KNOWLEDGE_STORAGE_OBJECT_NOT_FOUND' })
      const data = corruptReadback ? Buffer.from([9, 9, 9]) : Buffer.from(stored.data)
      return { key, versionId, bytes: data, sha256: digest(data), byteLength: data.length }
    }),
    recoverImmutable: vi.fn(),
    statExact: vi.fn(),
  }
  const buckets = { source: sourceBucket, backup: backupBucket, target: targetBucket }
  memory.storagePort = createS3ObjectStoragePort({ endpoint: 'http://127.0.0.1:9000', bucket: buckets[name],
    accessKeyId: 'synthetic', secretAccessKey: 'synthetic-only',
    fetchFn: async (url, init) => {
      const parsed = new URL(url)
      const key = parsed.pathname.split('/').slice(2).map(decodeURIComponent).join('/')
      if (init.method === 'PUT') {
        const result = await memory.putImmutable({ key, content: Buffer.from(init.body), expectedSha256: init.headers['x-amz-content-sha256'] })
        return new Response(null, { status: 200, headers: { 'x-amz-version-id': result.versionId } })
      }
      if (init.method === 'GET') {
        const result = await memory.readExact({ key, versionId: parsed.searchParams.get('versionId') })
        return new Response(result.bytes, { status: 200, headers: { 'x-amz-version-id': result.versionId } })
      }
      throw new Error('Unexpected synthetic S3 request')
    },
  })
  return memory
}

function binding(id, bucket, objectPort, endpoint = 'http://127.0.0.1:9000') {
  return { id, revision: 1, endpoint, bucket, port: objectPort.storagePort }
}

function setup(rows = [storage('storage-1')], options = {}) {
  const events = []
  const sourcePort = port('source', events)
  const backupPort = port('backup', events)
  const targetPort = port('target', events, options)
  const data = snapshot(rows)
  for (const row of rows) if (row.status === 'READY' && row.objectVersionId) sourcePort.seed(row.objectKey, row.objectVersionId)
  return {
    snapshot: data, events, sourcePort, backupPort, targetPort,
    source: binding('source-binding', sourceBucket, sourcePort),
    backup: binding('backup-binding', backupBucket, backupPort),
    target: binding('target-binding', targetBucket, targetPort),
  }
}

function database(data, { name = 'zuri_knowledge_restore_test_01', provider = 'postgresql', rows = data.tables.knowledgeArtifactStorage } = {}) {
  const audits = [], operations = []
  const currentDatabase = vi.fn(async () => [{ name }])
  let auditNumber = 0
  const tx = {
    knowledgeArtifactStorage: { findMany: vi.fn(async () => rows) },
    knowledgeRawArtifact: { findMany: vi.fn(async () => data.tables.knowledgeRawArtifact) },
    knowledgeArtifactOperation: {
      findUnique: vi.fn(async ({ where }) => operations.find(row => row.idempotencyKey === where.idempotencyKey) || null),
      create: vi.fn(async ({ data: row }) => {
        const created = { id: `restore-operation-${operations.length + 1}`, ...row }
        operations.push(created)
        return created
      }),
    },
    auditEvent: {
      findFirst: vi.fn(async ({ where }) => audits.find(row => row.entityType === where.entityType && row.entityId === where.entityId) || null),
      findUnique: vi.fn(async ({ where }) => audits.find(row => row.id === where.id) || null),
      create: vi.fn(async ({ data: row }) => {
        const created = { id: `restore-audit-${++auditNumber}`, ...row }
        audits.push(created)
        return created
      }),
    },
  }
  return {
    _engineConfig: { activeProvider: provider },
    ...tx, audits, operations,
    $queryRaw: currentDatabase, $queryRawUnsafe: currentDatabase,
    $transaction: vi.fn(async callback => callback(tx)),
  }
}

function ledger({ watermark = 13, withheldStorageIds = [], id = backupId } = {}) {
  return { schemaVersion: 'knowledge-test-erasure-ledger.v1', backupId: id, watermark, withheldStorageIds, authority: 'SYNTHETIC_TEST' }
}

async function makeBackup(rows = [storage('storage-1')], options = {}) {
  const fixture = setup(rows, options)
  const result = await createKnowledgeObjectBackup({
    snapshot: fixture.snapshot, backupId, sourceRevision,
    source: fixture.source, backup: fixture.backup, erasureWatermark: 12,
  })
  return { ...fixture, ...result }
}

async function makeRestored() {
  const { snapshot: data, ...fixture } = await makeBackup()
  const db = database(data)
  const result = await restoreKnowledgeObjectBackup({
    snapshot: data, manifest: fixture.manifest, manifestSha256: fixture.manifestSha256,
    backup: fixture.backup, target: fixture.target, db, restoreId,
    actorId: 'test-operator', reason: 'synthetic diagnostic qualification', testErasureLedger: ledger(),
  })
  return { ...fixture, snapshot: data, db, ...result }
}

describe('TASK-ZAI-049 §8.1 offline synthetic object recovery', () => {
  it('does not trust copied identity fields or a method-shape wrapper', async () => {
    const fixture = setup()
    const read = vi.fn(), put = vi.fn()
    fixture.source.port = Object.freeze({ readExact: read, putImmutable: put,
      identity: Object.freeze({ endpoint: fixture.source.endpoint, bucket: sourceBucket, region: 'us-east-1' }) })
    expect(getS3ObjectStoragePortIdentity(fixture.source.port)).toBeNull()
    await expect(createKnowledgeObjectBackup({ snapshot: fixture.snapshot, backupId, sourceRevision,
      source: fixture.source, backup: fixture.backup, erasureWatermark: 12 }))
      .rejects.toMatchObject({ code: 'KNOWLEDGE_OBJECT_RECOVERY_PORT_IDENTITY_MISMATCH' })
    expect(read).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(fixture.backupPort.putImmutable).not.toHaveBeenCalled()
    const genuine = getS3ObjectStoragePortIdentity(fixture.target.port)
    expect(Object.isFrozen(genuine)).toBe(true)
    expect(genuine).toEqual({ endpoint: 'http://127.0.0.1:9000/', bucket: targetBucket, region: 'us-east-1' })
  })

  it('checks the backup write port identity before reading source bytes', async () => {
    const fixture = setup()
    const io = vi.fn(async () => { throw new Error('wrong bucket must not receive any request') })
    fixture.backup.port = createS3ObjectStoragePort({ endpoint: fixture.backup.endpoint,
      bucket: 'zuri-restore-test-other', accessKeyId: 'synthetic', secretAccessKey: 'synthetic-only', fetchFn: io })
    await expect(createKnowledgeObjectBackup({ snapshot: fixture.snapshot, backupId, sourceRevision,
      source: fixture.source, backup: fixture.backup, erasureWatermark: 12 }))
      .rejects.toMatchObject({ code: 'KNOWLEDGE_OBJECT_RECOVERY_PORT_IDENTITY_MISMATCH' })
    expect(io).not.toHaveBeenCalled()
    expect(fixture.sourcePort.readExact).not.toHaveBeenCalled()
  })

  it('keeps the validated destination port when a descriptor changes during an awaited source read', async () => {
    const fixture = setup()
    const io = vi.fn(async () => { throw new Error('a swapped port must never receive copied bytes') })
    const swapped = createS3ObjectStoragePort({ endpoint: 'http://127.0.0.1:9999', bucket: backupBucket,
      accessKeyId: 'synthetic', secretAccessKey: 'synthetic-only', fetchFn: io })
    const read = fixture.sourcePort.readExact.getMockImplementation()
    fixture.sourcePort.readExact.mockImplementationOnce(async args => {
      fixture.backup.port = swapped
      return read(args)
    })
    await expect(createKnowledgeObjectBackup({ snapshot: fixture.snapshot, backupId, sourceRevision,
      source: fixture.source, backup: fixture.backup, erasureWatermark: 12 })).resolves.toMatchObject({
      manifest: { entries: [{ backup: { bucket: backupBucket, versionId: 'backup-v1' } }] },
    })
    expect(io).not.toHaveBeenCalled()
    expect(fixture.backupPort.putImmutable).toHaveBeenCalledTimes(1)
  })

  it('checks restore and diagnostic target ports before storage or database I/O', async () => {
    const fixture = await makeRestored()
    fixture.targetPort.readExact.mockClear()
    fixture.backupPort.readExact.mockClear()
    fixture.db.$queryRawUnsafe.mockClear()
    const io = vi.fn(async () => { throw new Error('wrong endpoint must not receive any request') })
    const wrong = { ...fixture.target, port: createS3ObjectStoragePort({ endpoint: 'http://127.0.0.1:9999',
      bucket: targetBucket, accessKeyId: 'synthetic', secretAccessKey: 'synthetic-only', fetchFn: io }) }
    await expect(restoreKnowledgeObjectBackup({ snapshot: fixture.snapshot, manifest: fixture.manifest,
      manifestSha256: fixture.manifestSha256, backup: fixture.backup, target: wrong, db: fixture.db,
      restoreId, actorId: 'test-operator', reason: 'TEST identity denial', testErasureLedger: ledger() }))
      .rejects.toMatchObject({ code: 'KNOWLEDGE_OBJECT_RECOVERY_PORT_IDENTITY_MISMATCH' })
    await expect(verifyRestoredKnowledgeObject({ receipt: fixture.receipt, auditId: fixture.auditId,
      storageId: 'storage-1', db: fixture.db, target: wrong, testErasureLedger: ledger() }))
      .rejects.toMatchObject({ code: 'KNOWLEDGE_OBJECT_RECOVERY_PORT_IDENTITY_MISMATCH' })
    expect(io).not.toHaveBeenCalled()
    expect(fixture.targetPort.readExact).not.toHaveBeenCalled()
    expect(fixture.backupPort.readExact).not.toHaveBeenCalled()
    expect(fixture.db.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it.each([
    { endpoint: 'http://127.0.0.1:9001', bucket: sourceBucket, region: 'us-east-1' },
    { endpoint: 'http://127.0.0.1:9000', bucket: 'zuri-restore-test-other', region: 'us-east-1' },
    { endpoint: 'http://127.0.0.1:9000', bucket: sourceBucket, region: 'eu-west-1' },
  ])('rejects a TEST descriptor paired with a different real port identity before I/O: %j', async actualIdentity => {
    const fixture = setup()
    const io = vi.fn(async () => { throw new Error('mismatched port must never perform I/O') })
    fixture.source.port = createS3ObjectStoragePort({ ...actualIdentity, accessKeyId: 'synthetic',
      secretAccessKey: 'synthetic-only', fetchFn: io })
    await expect(createKnowledgeObjectBackup({ snapshot: fixture.snapshot, backupId, sourceRevision,
      source: fixture.source, backup: fixture.backup, erasureWatermark: 12 }))
      .rejects.toMatchObject({ code: 'KNOWLEDGE_OBJECT_RECOVERY_PORT_IDENTITY_MISMATCH' })
    expect(io).not.toHaveBeenCalled()
    expect(fixture.backupPort.putImmutable).not.toHaveBeenCalled()
  })

  it('backs up only the pinned source version and verifies bytes before emitting a content-free manifest', async () => {
    const fixture = setup()
    const result = await createKnowledgeObjectBackup({
      snapshot: fixture.snapshot, backupId, sourceRevision,
      source: fixture.source, backup: fixture.backup, erasureWatermark: 12,
    })
    const row = fixture.snapshot.tables.knowledgeArtifactStorage[0]
    expect(result.manifest).toMatchObject({
      schemaVersion: 'knowledge-object-backup.v1', backupId, sourceRevision,
      erasureWatermark: 12, snapshotSha256: digest(canonical(fixture.snapshot)),
      entries: [{ storageId: row.id, rawArtifactId: row.rawArtifactId, status: 'COPIED', sha256: objectHash, byteLength: bytes.length,
        original: { bucket: sourceBucket, key: row.objectKey, versionId: row.objectVersionId },
        backup: { bucket: backupBucket, versionId: 'backup-v1' } }],
    })
    expect(result.manifestSha256).toBe(digest(canonical(result.manifest)))
    expect(JSON.stringify(result.manifest)).not.toContain(textSentinel)
    expect(JSON.stringify(result.manifest)).not.toContain(bytes.toString('base64'))
    expect(fixture.events).toEqual([
      `source:read:${row.objectKey}:${row.objectVersionId}`,
      `backup:put:${row.objectKey}`,
      `backup:read:${row.objectKey}:backup-v1`,
    ])
    expect(fixture.sourcePort.recoverImmutable).not.toHaveBeenCalled()
    expect(fixture.backupPort.statExact).not.toHaveBeenCalled()
    expect(row.objectVersionId).toBe('source-storage-1-v1')
  })

  it('accepts the canonical GenesisRAG17 scope with empty workspaceId and agentId strings', async () => {
    const emptyScope = { ...scope, workspaceId: '', agentId: '' }
    const fixture = setup([storage('storage-empty-scope', 'raw-empty-scope', emptyScope)])

    const result = await createKnowledgeObjectBackup({
      snapshot: fixture.snapshot, backupId, sourceRevision,
      source: fixture.source, backup: fixture.backup, erasureWatermark: 12,
    })

    expect(result.manifest.scope).toEqual(emptyScope)
    expect(result.manifest.entries).toMatchObject([{ storageId: 'storage-empty-scope', status: 'COPIED' }])
    expect(fixture.sourcePort.readExact).toHaveBeenCalledWith({
      key: fixture.snapshot.tables.knowledgeArtifactStorage[0].objectKey,
      versionId: 'source-storage-empty-scope-v1',
    })
  })

  it('withholds ERASED rows and rejects incomplete, mixed-scope, mismatched-hash, or non-TEST bindings before I/O', async () => {
    const erased = storage('storage-erased', 'raw-erased', { status: 'ERASED' })
    const held = setup([erased])
    const withheld = await createKnowledgeObjectBackup({ snapshot: held.snapshot, backupId, sourceRevision, source: held.source, backup: held.backup, erasureWatermark: 12 })
    expect(withheld.manifest.entries).toMatchObject([{ storageId: 'storage-erased', status: 'WITHHELD' }])
    expect(held.sourcePort.readExact).not.toHaveBeenCalled()
    expect(held.backupPort.putImmutable).not.toHaveBeenCalled()

    const cases = [
      setup([storage('storage-1', 'raw-storage-1', { status: 'PENDING' })]),
      setup([storage('storage-1', 'raw-storage-1', { status: 'QUARANTINED' })]),
      setup([storage('storage-1', 'raw-storage-1', { status: 'ERASURE_PENDING' })]),
      setup([storage('storage-1', 'raw-storage-1', { objectVersionId: null })]),
      setup([storage('storage-1', 'raw-storage-1', { tenantId: 'other-tenant' })]),
      setup([storage('storage-1', 'raw-storage-1', { sha256: 'f'.repeat(64) })]),
      setup([storage('storage-1'), storage('storage-2', 'raw-storage-2', { businessId: 'other-business' })]),
      setup([storage('storage-1')]),
    ]
    cases[4].snapshot.tables.knowledgeRawArtifact[0].tenantId = scope.tenantId
    const rawMismatch = setup()
    rawMismatch.snapshot.tables.knowledgeRawArtifact[0].tenantId = 'another-tenant'
    cases.push(rawMismatch)
    cases[7].source = binding('source-binding', sourceBucket, cases[7].sourcePort, 'https://storage.example')
    cases.push(setup())
    cases.at(-1).backup = binding('backup-binding', sourceBucket, cases.at(-1).backupPort)
    for (const fixture of cases) {
      await expect(createKnowledgeObjectBackup({ snapshot: fixture.snapshot, backupId, sourceRevision, source: fixture.source, backup: fixture.backup, erasureWatermark: 12 })).rejects.toThrow()
      expect(fixture.sourcePort.readExact).not.toHaveBeenCalled()
      expect(fixture.backupPort.putImmutable).not.toHaveBeenCalled()
    }
    const invalidIdentity = setup()
    await expect(createKnowledgeObjectBackup({ snapshot: invalidIdentity.snapshot, backupId: 'bad-id', sourceRevision, source: invalidIdentity.source, backup: invalidIdentity.backup, erasureWatermark: 12 })).rejects.toThrow()
    await expect(createKnowledgeObjectBackup({ snapshot: invalidIdentity.snapshot, backupId, sourceRevision: 'short', source: invalidIdentity.source, backup: invalidIdentity.backup, erasureWatermark: 12 })).rejects.toThrow()
    expect(invalidIdentity.sourcePort.readExact).not.toHaveBeenCalled()
  })

  it('fails before copy when the named PostgreSQL TEST DB inventory, target bucket, manifest hash, or erasure evidence is invalid', async () => {
    const { snapshot: data, ...fixture } = await makeBackup()
    fixture.backupPort.readExact.mockClear()
    const changed = structuredClone(fixture.manifest)
    changed.entries[0].sha256 = 'f'.repeat(64)
    const validArgs = db => ({
      snapshot: data, manifest: fixture.manifest, manifestSha256: fixture.manifestSha256,
      backup: fixture.backup, target: fixture.target, db, restoreId,
      actorId: 'test-operator', reason: 'synthetic TASK-ZAI-049 §8.1 qualification', testErasureLedger: ledger(),
    })
    const cases = [
      validArgs(database(data, { provider: 'sqlite' })),
      validArgs(database(data, { name: 'main_dev_database' })),
      validArgs(database(data, { rows: [] })),
      { ...validArgs(database(data)), testErasureLedger: undefined },
      { ...validArgs(database(data)), testErasureLedger: ledger({ watermark: 11 }) },
      { ...validArgs(database(data)), testErasureLedger: ledger({ id: '33333333-3333-4333-8333-333333333333' }) },
      { ...validArgs(database(data)), testErasureLedger: ledger({ withheldStorageIds: ['unknown-storage'] }) },
      { ...validArgs(database(data)), manifest: changed },
      { ...validArgs(database(data)), target: binding('target-binding', fixture.backup.bucket, fixture.targetPort) },
      { ...validArgs(database(data)), target: binding('target-binding', 'knowledge-prod', fixture.targetPort) },
    ]
    const dbs = cases.map(item => item.db)
    for (const item of cases) await expect(restoreKnowledgeObjectBackup(item)).rejects.toThrow()
    expect(fixture.backupPort.readExact).not.toHaveBeenCalled()
    expect(fixture.targetPort.putImmutable).not.toHaveBeenCalled()
    for (const db of dbs) { expect(db.audits).toHaveLength(0); expect(db.operations).toHaveLength(0) }
  })

  it('records verified original-to-backup-to-restore refs, withholds current erasures, and diagnoses only pinned versions', async () => {
    const { snapshot: data, ...fixture } = await makeBackup([storage('storage-1'), storage('storage-2', 'raw-storage-2')])
    fixture.backupPort.readExact.mockClear()
    const before = structuredClone(data.tables.knowledgeArtifactStorage)
    const db = database(data)
    const testLedger = ledger({ withheldStorageIds: ['storage-2'] })
    const restored = await restoreKnowledgeObjectBackup({
      snapshot: data, manifest: fixture.manifest, manifestSha256: fixture.manifestSha256,
      backup: fixture.backup, target: fixture.target, db, restoreId,
      actorId: 'test-operator', reason: 'synthetic TASK-ZAI-049 §8.1 qualification', testErasureLedger: testLedger,
    })
    expect(restored.receipt).toMatchObject({
      schemaVersion: 'knowledge-object-restore.v1', restoreId, backupId,
      manifestSha256: fixture.manifestSha256, fullAcceptance: false,
      runtimeActivated: false, servingEnabled: false,
      entries: [
        { storageId: 'storage-1', status: 'VERIFIED', original: { versionId: 'source-storage-1-v1' }, backup: { versionId: 'backup-v1' }, restored: { versionId: 'target-v1' }, sha256: objectHash, byteLength: bytes.length },
        { storageId: 'storage-2', status: 'WITHHELD', restored: null },
      ],
    })
    expect(JSON.stringify(restored.receipt)).not.toContain(textSentinel)
    expect(data.tables.knowledgeArtifactStorage).toEqual(before)
    expect(fixture.targetPort.putImmutable).toHaveBeenCalledTimes(1)
    expect(fixture.backupPort.readExact.mock.calls.map(([arg]) => arg.versionId)).toEqual(['backup-v1'])
    expect(db.audits[0]).toMatchObject({ id: restored.auditId, tenantId: scope.tenantId, businessId: scope.businessId })
    expect(JSON.stringify(db.audits[0])).toContain('target-v1')
    expect(db.operations[0]).toMatchObject({ storageId: 'storage-1', operation: 'RESTORE', status: 'VERIFIED', evidenceHash: digest(canonical(restored.receipt)) })

    await expect(verifyRestoredKnowledgeObject({ receipt: restored.receipt, auditId: restored.auditId, storageId: 'storage-1', db, target: fixture.target, testErasureLedger: testLedger }))
      .resolves.toMatchObject({ verified: true, sha256: objectHash, byteLength: bytes.length })
    expect(fixture.targetPort.readExact.mock.calls.at(-1)[0].versionId).toBe('target-v1')
    fixture.targetPort.readExact.mockClear()
    await expect(verifyRestoredKnowledgeObject({ receipt: restored.receipt, auditId: restored.auditId, storageId: 'storage-2', db, target: fixture.target, testErasureLedger: testLedger })).rejects.toThrow()
    await expect(verifyRestoredKnowledgeObject({ receipt: restored.receipt, auditId: restored.auditId, storageId: 'storage-1', db, target: fixture.target, testErasureLedger: ledger({ watermark: 14, withheldStorageIds: ['storage-1'] }) })).rejects.toThrow()
    expect(fixture.targetPort.readExact).not.toHaveBeenCalled()
  })

  it('checks actual TEST database identity before diagnostic audit or object reads', async () => {
    const fixture = await makeRestored()
    fixture.targetPort.readExact.mockClear()
    fixture.db._engineConfig.activeProvider = 'sqlite'

    await expect(verifyRestoredKnowledgeObject({
      receipt: fixture.receipt, auditId: fixture.auditId, storageId: 'storage-1',
      db: fixture.db, target: fixture.target, testErasureLedger: ledger(),
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_OBJECT_RECOVERY_DATABASE_DENIED' })

    expect(fixture.db.auditEvent.findUnique).not.toHaveBeenCalled()
    expect(fixture.targetPort.readExact).not.toHaveBeenCalled()
  })

  it('rejects a RESTORE operation whose storage identity no longer matches the receipt', async () => {
    const fixture = await makeRestored()
    fixture.targetPort.readExact.mockClear()
    fixture.db.operations[0].storageId = 'other-storage'

    await expect(verifyRestoredKnowledgeObject({
      receipt: fixture.receipt, auditId: fixture.auditId, storageId: 'storage-1',
      db: fixture.db, target: fixture.target, testErasureLedger: ledger(),
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_OBJECT_RECOVERY_AUDIT_INVALID' })

    expect(fixture.targetPort.readExact).not.toHaveBeenCalled()
  })

  it('does not journal target bytes that fail exact-version readback verification', async () => {
    const fixture = setup([storage('storage-1')], { corruptReadback: true })
    const backup = await createKnowledgeObjectBackup({ snapshot: fixture.snapshot, backupId, sourceRevision, source: fixture.source, backup: fixture.backup, erasureWatermark: 12 })
    const db = database(fixture.snapshot)
    await expect(restoreKnowledgeObjectBackup({
      snapshot: fixture.snapshot, ...backup, backup: fixture.backup, target: fixture.target, db, restoreId,
      actorId: 'test-operator', reason: 'synthetic TEST readback', testErasureLedger: ledger(),
    })).rejects.toThrow()
    expect(db.audits).toHaveLength(0)
    expect(db.operations).toHaveLength(0)
  })
})
