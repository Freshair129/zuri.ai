// @spec ADR-107 - file lifecycle, authorization and exact-version service proof.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { FileManagementError } from '../src/errors.js'
import { createFileService } from '../src/file-service.js'
import { actorId, businessA, businessB, makeAuthority, MemoryRepository, MemoryStorage, sha256, tenantId } from './fakes.js'

const text = (value) => Buffer.from(value, 'utf8')

async function setup(t, { extraPermissions = [] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'file-service-test-'))
  t.after(async () => rm(directory, { recursive: true, force: true }))
  const repository = new MemoryRepository()
  const storage = new MemoryStorage()
  const authority = makeAuthority({ extraPermissions })
  const service = createFileService({ repository, storage, authority })
  const identities = new Map()
  const requestMetadata = (idempotencyKey) => {
    if (!identities.has(idempotencyKey)) identities.set(idempotencyKey, { operationId: randomUUID(), correlationId: randomUUID() })
    return { ...identities.get(idempotencyKey), deadlineAt: new Date(Date.now() + 60000).toISOString() }
  }
  const upload = async ({ body = text('sku,price\nSKU-1,10\n'), idempotencyKey = `idem-${randomUUID()}`, fileName = 'catalog.csv', operation = 'create' } = {}) => {
    const bodyPath = join(directory, `${randomUUID()}.upload`)
    await writeFile(bodyPath, body, { flag: 'wx', mode: 0o600 })
    const action = operation === 'create' ? 'files:create' : 'files:write'
    const grant = await service.authorize({ bearerToken: 'test-user-token', action, tenantId, businessId: businessB })
    const input = { grant, ...requestMetadata(idempotencyKey), idempotencyKey, fileName, contentType: 'text/csv; charset=utf-8', sha256: sha256(body), byteLength: body.length, provenance: { kind: 'BROWSER_UPLOAD', sourceId: 'browser-session-fixture' }, bodyPath }
    return { bodyPath, result: operation === 'create' ? await service.createFile(input) : await service.appendVersion(input) }
  }
  return { service, repository, storage, authority, upload, requestMetadata, directory }
}

test('stores an original with exact hash, provider version, audit and outbox receipts', async (t) => {
  const { upload, repository, storage } = await setup(t)
  const original = text('sku,price\nSKU-1,10\n')
  const { result } = await upload({ body: original })
  assert.equal(result.status, 'STORED')
  assert.equal(result.sha256, createHash('sha256').update(original).digest('hex'))
  assert.equal(result.byteLength, original.length)
  assert.match(result.storageVersionId, /^provider-/)
  assert.equal(repository.files.get(result.fileId).currentVersionId, result.versionId)
  assert.equal(repository.auditEvents.length, 1)
  assert.equal(repository.auditEvents[0].type, 'FILE_VERSION_STORED')
  assert.equal(repository.outboxEvents.length, 1)
  assert.equal(repository.outboxEvents[0].type, 'FILE_VERSION_READY')
  assert.equal(repository.outboxEvents[0].versionId, result.versionId)
  assert.equal(storage.objects.size, 1)
})

test('reconciles a lost storage response by the same idempotency identity without duplicating bytes', async (t) => {
  const { upload, storage } = await setup(t)
  storage.loseNextResponse = true
  const body = text('original survives the lost response')
  const idempotencyKey = `idem-${randomUUID()}`
  await assert.rejects(upload({ body, idempotencyKey }), (error) => error.code === 'FILE_STORAGE_WRITE_UNCERTAIN')
  const { result } = await upload({ body, idempotencyKey })
  assert.equal(result.status, 'STORED')
  assert.equal(storage.objects.size, 1)
  assert.equal(result.sha256, sha256(body))
})

test('does not retry a pending operation against a changed storage bucket', async (t) => {
  const { upload, storage } = await setup(t)
  storage.loseNextResponse = true
  const body = text('original stays in the original bucket')
  const idempotencyKey = `idem-${randomUUID()}`
  await assert.rejects(upload({ body, idempotencyKey }), (error) => error.code === 'FILE_STORAGE_WRITE_UNCERTAIN')
  storage.bucket = 'replacement-private-files'
  await assert.rejects(upload({ body, idempotencyKey }), (error) => error.code === 'FILE_STORAGE_BINDING_CHANGED' && error.status === 503)
  assert.equal(storage.putCount, 1)
  assert.equal(storage.objects.size, 1)
})

test('does not retry a pending operation against a different provider binding with the same bucket name', async (t) => {
  const { upload, storage } = await setup(t)
  storage.loseNextResponse = true
  const body = text('original stays bound to its provider')
  const idempotencyKey = `idem-${randomUUID()}`
  await assert.rejects(upload({ body, idempotencyKey }), (error) => error.code === 'FILE_STORAGE_WRITE_UNCERTAIN')
  storage.bindingId = 'fixture-storage-b'
  await assert.rejects(upload({ body, idempotencyKey }), (error) => error.code === 'FILE_STORAGE_BINDING_CHANGED' && error.status === 503)
  assert.equal(storage.putCount, 1)
  assert.equal(storage.objects.size, 1)
})

test('does not reuse an idempotency key for different bytes or metadata', async (t) => {
  const { upload, storage } = await setup(t)
  const idempotencyKey = `idem-${randomUUID()}`
  await upload({ idempotencyKey, body: text('version one') })
  await assert.rejects(upload({ idempotencyKey, body: text('different bytes') }), (error) => error.code === 'FILE_IDEMPOTENCY_CONFLICT' && error.status === 409)
  assert.equal(storage.objects.size, 1)
})

test('appends immutable history and reads the selected exact version bytes', async (t) => {
  const { service, upload, repository, storage, requestMetadata } = await setup(t)
  const first = await upload({ body: text('version one') })
  const firstVersion = first.result.versionId
  const grant = await service.authorize({ bearerToken: 'test-user-token', action: 'files:write', tenantId, businessId: businessB })
  const secondPath = join((await import('node:os')).tmpdir(), `fm-${randomUUID()}.upload`)
  const secondBytes = text('version two')
  await writeFile(secondPath, secondBytes, { flag: 'wx', mode: 0o600 })
  t.after(async () => rm(secondPath, { force: true }))
  const idempotencyKey = `idem-${randomUUID()}`
  const second = await service.appendVersion({ grant, ...requestMetadata(idempotencyKey), fileId: first.result.fileId, idempotencyKey, fileName: 'catalog.csv', contentType: 'text/csv', sha256: sha256(secondBytes), byteLength: secondBytes.length, provenance: { kind: 'BROWSER_UPLOAD', sourceRevision: 'correction-2' }, bodyPath: secondPath })
  assert.equal(second.versionNumber, 2)
  const readGrant = await service.authorize({ bearerToken: 'test-user-token', action: 'files:read', tenantId, businessId: businessB })
  assert.equal((await service.listVersions({ grant: readGrant, fileId: first.result.fileId })).length, 2)
  const old = await service.readVersion({ grant: readGrant, fileId: first.result.fileId, versionId: firstVersion })
  const chunks = []
  for await (const chunk of old.body) chunks.push(chunk)
  assert.deepEqual(Buffer.concat(chunks), text('version one'))
  assert.equal(storage.objects.size, 2)
  assert.equal(repository.files.get(first.result.fileId).currentVersionId, second.versionId)
})

test('denies a different Business before creating a storage object', async (t) => {
  const { service, storage, authority } = await setup(t)
  await assert.rejects(service.authorize({ bearerToken: 'test-user-token', action: 'files:create', tenantId, businessId: businessA }), (error) => error instanceof FileManagementError && error.status === 403)
  assert.equal(authority.calls.length, 1)
  assert.equal(storage.objects.size, 0)
  assert.equal(actorId, '30000000-0000-4000-8000-000000000001')
})

test('append preflight hides a file owned by another Business before body intake', async (t) => {
  const { service, repository, storage } = await setup(t)
  const fileId = randomUUID()
  repository.files.set(fileId, { id: fileId, tenantId, businessId: businessA, status: 'ACTIVE', deletedAt: null })
  const grant = await service.authorize({ bearerToken: 'test-user-token', action: 'files:write', tenantId, businessId: businessB })

  await assert.rejects(service.preflightAppend({ grant, fileId }), (error) => error.code === 'FILE_NOT_FOUND' && error.status === 404)
  assert.equal(storage.putCount, 0)
})

test('does not accept a caller-forged authority grant', async (t) => {
  const { service, storage } = await setup(t)
  const body = text('forged scope')
  const bodyPath = join((await import('node:os')).tmpdir(), `fm-forged-${randomUUID()}.upload`)
  await writeFile(bodyPath, body, { flag: 'wx', mode: 0o600 })
  t.after(async () => rm(bodyPath, { force: true }))
  await assert.rejects(service.createFile({
    grant: { actorId, tenantId, businessId: businessB, permissions: ['files:create'] },
    idempotencyKey: `idem-${randomUUID()}`,
    fileName: 'forged.txt',
    contentType: 'text/plain',
    sha256: sha256(body),
    byteLength: body.length,
    provenance: { kind: 'OTHER' },
    bodyPath,
  }), (error) => error.code === 'FILE_AUTHORITY_DENIED')
  assert.equal(storage.objects.size, 0)
})

test('does not let a normal upload claim LINE provenance', async (t) => {
  const { service, storage } = await setup(t)
  const provenance = { kind: 'LINE_CAPTURE', sourceId: 'claimed-message', channelBindingId: 'fixture-channel', providerMessageId: 'fixture-message', attachmentOrdinal: 0, contentProviderType: 'line' }
  await assert.rejects(service.authorize({ bearerToken: 'test-user-token', action: 'files:create', tenantId, businessId: businessB, provenance }), (error) => error.code === 'FILE_PROVENANCE_DENIED')
  assert.equal(storage.objects.size, 0)
})

test('requires explicit authority permissions for Git, Knowledge, and API provenance', async (t) => {
  const { service, storage } = await setup(t)
  for (const kind of ['GIT_SNAPSHOT', 'KNOWLEDGE_EXPORT', 'API_IMPORT']) {
    await assert.rejects(service.authorize({ bearerToken: 'test-user-token', action: 'files:create', tenantId, businessId: businessB, provenance: { kind, sourceId: 'fixture-source' } }), (error) => error.code === 'FILE_PROVENANCE_DENIED')
  }
  assert.equal(storage.objects.size, 0)
})
test('accepts a synthetic LINE capture only with source-specific authority and records its provenance', async (t) => {
  const { service, storage, repository, authority, directory, requestMetadata } = await setup(t, { extraPermissions: ['files:line-capture'] })
  const body = text('synthetic LINE attachment bytes')
  const bodyPath = join(directory, randomUUID() + '.upload')
  await writeFile(bodyPath, body, { flag: 'wx', mode: 0o600 })
  const provenance = { kind: 'LINE_CAPTURE', sourceId: 'fixture-capture-1', channelBindingId: 'fixture-line-channel-1', providerMessageId: 'fixture-message-17', attachmentOrdinal: 1, contentProviderType: 'external', capturedAt: '2026-09-24T01:00:00.000Z' }
  const grant = await service.authorize({ bearerToken: 'test-user-token', action: 'files:create', tenantId, businessId: businessB, provenance })
  assert.deepEqual(authority.calls[0].provenance, provenance)
  const idempotencyKey = 'idem-' + randomUUID()
  const receipt = await service.createFile({ grant, ...requestMetadata(idempotencyKey), idempotencyKey, fileName: 'attachment.jpg', contentType: 'image/jpeg', sha256: sha256(body), byteLength: body.length, provenance, bodyPath })
  assert.equal(storage.objects.size, 1)
  assert.deepEqual(repository.versions.get(receipt.fileId)[0].provenance, provenance)
})

test('rejects incomplete LINE provenance before asking authority', async (t) => {
  const { service, authority } = await setup(t)
  await assert.rejects(service.authorize({ bearerToken: 'test-user-token', action: 'files:create', tenantId, businessId: businessB, provenance: { kind: 'LINE_CAPTURE', sourceId: 'fixture-message' } }), (error) => error.code === 'FILE_PROVENANCE_INVALID')
  assert.equal(authority.calls.length, 0)
})

test('fails closed before an operation record when private storage is unversioned', async (t) => {
  const { storage, repository, upload } = await setup(t)
  storage.health = async () => false
  await assert.rejects(upload(), (error) => error.code === 'FILE_STORAGE_UNAVAILABLE')
  assert.equal(storage.objects.size, 0)
  assert.equal(repository.operations.size, 0)
})

test('withdrawn file records are not readable', async (t) => {
  const { service, upload, repository } = await setup(t)
  const result = await upload()
  repository.files.get(result.result.fileId).status = 'WITHDRAWN'
  const grant = await service.authorize({ bearerToken: 'test-user-token', action: 'files:read', tenantId, businessId: businessB })
  await assert.rejects(service.getFile({ grant, fileId: result.result.fileId }), (error) => error.code === 'FILE_NOT_FOUND' && error.status === 404)
})

test('rejects a corrupted exact-version read even when the byte length matches', async (t) => {
  const { service, upload, storage } = await setup(t)
  const uploaded = await upload({ body: text('content') })
  storage.corruptReads = true
  const grant = await service.authorize({ bearerToken: 'test-user-token', action: 'files:read', tenantId, businessId: businessB })
  const result = await service.readVersion({ grant, fileId: uploaded.result.fileId, versionId: uploaded.result.versionId })
  await assert.rejects(async () => { for await (const _chunk of result.body) {} }, (error) => error.code === 'FILE_CONTENT_MISMATCH')
})
