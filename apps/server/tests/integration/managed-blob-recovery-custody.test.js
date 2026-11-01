// @req FR-292, FR-293 — durable custody cannot become authority or escape backup exclusion.
// @spec ADR-115, SEC-008
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, unlink, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import db from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { generateSessionToken, persistSession } from '@/modules/identity/auth-service'
import * as recovery from '@/modules/project-manager/application/managed-blob-recovery-service'
import { exportSnapshot } from '@/modules/project-manager/application/backup-service'

const bytes = Buffer.from('original')
// Independently calculated SHA-256 of the eight UTF-8 bytes "original".
const digest = '0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5'
const env = { ZURI_SESSION_SECRET: 'or2-isolated-session-test-secret', ZURI_ASSET_STORAGE_PROVIDER: 's3',
  ZURI_ASSET_EVIDENCE_BUCKET: 'asset-private', ZURI_ASSET_STORAGE_ENDPOINT: 'http://storage.test:9000',
  ZURI_ASSET_STORAGE_ACCESS_KEY: 'test', ZURI_ASSET_STORAGE_SECRET_KEY: 'test',
  ZURI_KNOWLEDGE_CATALOG_BUCKET: 'catalog-private', ZURI_KNOWLEDGE_STORAGE_BUCKET: 'knowledge-private' }
let scope, person, membership, request, file, root, service, objects, putCount, admittedFence = false
beforeAll(async () => {
  const id = randomUUID(), portfolio = await createPortfolio({ name: 'OR2', code: 'PF-' + id })
  const tenant = await createTenant({ name: 'OR2', portfolioId: portfolio.id, code: 'T-' + id })
  const business = await createBusiness({ name: 'OR2', tenantId: tenant.id, code: 'B-' + id })
  scope = { tenantId: tenant.id, businessId: business.id }
  person = await db.person.create({ data: { code: 'P-' + id, displayName: 'Recovery owner' } })
  membership = await db.membership.create({ data: { ...scope, personId: person.id, role: 'OWNER' } })
  const sessionId = randomUUID(), token = generateSessionToken(person.id, { secret: env.ZURI_SESSION_SECRET, sessionId })
  await persistSession({ token, sessionId, personId: person.id, db, env })
  request = new Request('http://localhost/api/files', { headers: { cookie: 'zuri_session=' + token } })
  // Trusted TEST configuration must satisfy the unchanged canonical-root guard;
  // runner temp paths can use an alias/casing different from filesystem realpath.
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'zuri-or2-')))
})
afterAll(async () => {
  try {
    // The PostgreSQL profile shares one disposable database between files.
    // Remove this suite's history/refs after its assertions; retaining them
    // correctly blocks unrelated legacy backups in the following suites.
    if (scope) {
      await db.managedBlobRecoveryOperation.deleteMany({ where: scope })
      await db.fileAsset.deleteMany({ where: scope })
    }
    if (admittedFence) await db.managedBlobRecoveryInstallationFence.deleteMany({ where: { id: 'installation' } })
  } finally { if (root) await rm(root, { recursive: true, force: true }) }
})
beforeEach(async () => {
  objects = new Map(); putCount = 0
  if (!recovery.createManagedBlobRecoveryService) return
  await db.managedBlobRecoveryOperation.deleteMany()
  await db.managedBlobRecoveryInstallationFence.deleteMany()
  // Explicit fresh disposable TEST admission; runtime never bootstraps this row.
  await db.managedBlobRecoveryInstallationFence.create({ data: { id: 'installation', mode: 'READY', generation: 1 } })
  admittedFence = true
  await db.membership.update({ where: { id: membership.id }, data: { role: 'OWNER', status: 'ACTIVE' } })
  file = await db.fileAsset.create({ data: { ...scope, code: 'FIL-' + randomUUID(), name: 'original.pdf',
    storageKind: 'MANAGED_BLOB', mime: 'application/pdf', size: 8, sha256: digest,
    blobRef: `s3-business://asset/asset-private/asset-evidence/${scope.tenantId}/${scope.businessId}/original/file.pdf?versionId=v1` } })
  // The provider is the only fake boundary. Persistence, sessions, ownership,
  // filesystem spool, hashing, CAS and audit are real.
  service = recovery.createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn: async (url, init) => {
    const u = new URL(url), key = u.pathname, version = u.searchParams.get('versionId')
    if (init.method === 'PUT') { putCount++; objects.set(key, Buffer.from(init.body)); return new Response('', { status: 200, headers: { 'x-amz-version-id': 'owned-v1' } }) }
    if (init.method === 'HEAD' || init.method === 'GET') {
      if (!objects.has(key) || version && version !== 'owned-v1') return new Response('', { status: 404 })
      return new Response(init.method === 'HEAD' ? null : objects.get(key), { status: 200, headers: { 'x-amz-version-id': 'owned-v1' } })
    }
    throw new Error('Provider DELETE must remain disabled before attachment qualification')
  } })
})
const prepare = () => service.prepare({ request, fileId: file.id, input: { expectedVersion: 1 } })
async function staged() {
  const op = await prepare()
  const preview = await service.preview({ request, fileId: file.id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks: [bytes] })
  const input = { confirmationBinding: preview.confirmationBinding, expectedOperationVersion: preview.version }
  const stage = await service.stage({ request, fileId: file.id, operationId: op.operationId, input })
  return { op, preview, stage, input: { ...input, expectedOperationVersion: stage.version } }
}
describe('OR2 durable recovery', () => {
  it('commits one ref/version/audit and returns the matching durable result after response loss', async () => {
    expect(recovery.createManagedBlobRecoveryService).toBeTypeOf('function')
    const { op, input } = await staged()
    const before = await db.fileAsset.findUnique({ where: { id: file.id } })
    const result = await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    expect(result).toMatchObject({ state: 'COMMITTED', fileVersion: 2, targetCurrent: true, availability: 'VERIFIED' })
    const after = await db.fileAsset.findUnique({ where: { id: file.id } })
    expect(after).toMatchObject({ ...before, blobRef: expect.stringContaining('/recovery/'), version: 2, updatedAt: expect.any(Date) })
    const replay = await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    expect(replay).toMatchObject({ state: 'COMMITTED', fileVersion: 2 })
    expect(putCount).toBe(1)
    expect(await db.auditEvent.count({ where: { entityId: op.operationId, action: 'COMMITTED' } })).toBe(1)
    expect(JSON.stringify(result)).not.toMatch(/s3-business|asset-private|confirmationBinding|secret|workerId|spoolId/)
  })
  it('does not admit a missing fence or a restored generation without explicit admission', async () => {
    await db.managedBlobRecoveryInstallationFence.deleteMany()
    await expect(prepare()).rejects.toMatchObject({ status: 503 })
    await db.managedBlobRecoveryInstallationFence.create({ data: { id: 'installation' } })
    await expect(prepare()).rejects.toMatchObject({ status: 503 })
  })
  it('reserves capacity before consuming any bytes and counts expired UNKNOWN work', async () => {
    const one = await prepare(); await prepare()
    // Expired unused preparations now close safely. An attempted/unknown
    // external write remains unresolved regardless of expiry or absent spool.
    await db.managedBlobRecoveryOperation.update({ where: { id: one.operationId }, data: { expiresAt: new Date(0), state: 'UNKNOWN', attempts: 1 } })
    await expect(prepare()).rejects.toMatchObject({ status: 429 })
    expect(await db.managedBlobRecoveryOperation.count()).toBe(2)
  })
  it('rejects corrupt preview bytes without FileAsset mutation, with custody still accounted for', async () => {
    const op = await prepare()
    await expect(service.preview({ request, fileId: file.id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks: [Buffer.from('tampered')] }))
      .rejects.toMatchObject({ status: 400 })
    expect((await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).spoolBytes).toBe(8)
    expect(await service.cleanup({ request, fileId: file.id, operationId: op.operationId })).toMatchObject({ custody: { spoolBytes: 0, unresolved: false } })
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
    expect(putCount).toBe(0)
  })
  it.each(['REVOKED', 'MEMBER'])('refuses live ownership loss (%s) after staging', async mode => {
    const { op, input } = await staged()
    await db.membership.update({ where: { id: membership.id }, data: mode === 'MEMBER' ? { role: mode } : { status: mode } })
    await expect(service.confirm({ request, fileId: file.id, operationId: op.operationId, input })).rejects.toMatchObject({ status: 404 })
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
    expect(await db.auditEvent.count({ where: { entityId: op.operationId, action: 'COMMITTED' } })).toBe(0)
  })
  it.each([{ deletedAt: new Date() }, { status: 'QUARANTINED' }, { sha256: '0'.repeat(64) }, { size: 9 }, { version: 2 }])(
    'refuses the exact file CAS conflict %j without an audit or resurrection', async patch => {
      const { op, input } = await staged()
      await db.fileAsset.update({ where: { id: file.id }, data: patch })
      await expect(service.confirm({ request, fileId: file.id, operationId: op.operationId, input })).rejects.toThrow('Recovery request refused')
      expect(await db.auditEvent.count({ where: { entityId: op.operationId, action: 'COMMITTED' } })).toBe(0)
      expect((await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).state).toBe('STAGED')
    })
  it('rolls metadata and durable result back if the audit write fails', async () => {
    const { op, input } = await staged()
    // SQLite and PostgreSQL both enforce an actual DB failure in the audit
    // transaction, rather than mocking the transaction that should roll back.
    const postgres = /postgres/.test(db._engineConfig.activeProvider)
    if (postgres) {
      await db.$executeRawUnsafe(`CREATE FUNCTION or2_refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."action"='COMMITTED' AND NEW."entityType"='MANAGED_BLOB_RECOVERY' THEN RAISE EXCEPTION 'or2 injected audit failure'; END IF; RETURN NEW; END $$`)
      await db.$executeRawUnsafe('CREATE TRIGGER or2_refuse_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION or2_refuse_audit()')
    } else await db.$executeRawUnsafe(`CREATE TRIGGER or2_refuse_audit BEFORE INSERT ON "AuditEvent" WHEN NEW."entityType"='MANAGED_BLOB_RECOVERY' BEGIN SELECT RAISE(ABORT,'or2 injected audit failure'); END`)
    try {
      await expect(service.confirm({ request, fileId: file.id, operationId: op.operationId, input })).rejects.toMatchObject({ status: 503 })
      expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
      expect((await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).state).toBe('STAGED')
    } finally {
      await db.$executeRawUnsafe(postgres ? 'DROP TRIGGER or2_refuse_audit ON "AuditEvent"' : 'DROP TRIGGER or2_refuse_audit')
      if (postgres) await db.$executeRawUnsafe('DROP FUNCTION or2_refuse_audit()')
    }
  })
  it('preserves historical result after a later deletion and never claims current availability on status', async () => {
    const { op, input } = await staged()
    await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    await db.fileAsset.update({ where: { id: file.id }, data: { deletedAt: new Date() } })
    expect(await service.status({ request, fileId: file.id, operationId: op.operationId })).toMatchObject({ state: 'COMMITTED', targetCurrent: false, availability: 'NOT_CHECKED' })
  })
  it('reports missing postcommit bytes as recovery-required without undoing metadata', async () => {
    const { op, input } = await staged()
    objects.clear()
    const result = await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    expect(result).toMatchObject({ state: 'COMMITTED', availability: 'RECOVERY_REQUIRED' })
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(2)
  })
  it('deletes only owned spool after commit and still permits an identical confirmed-result retry', async () => {
    const { op, input } = await staged()
    await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    expect(await service.cleanup({ request, fileId: file.id, operationId: op.operationId })).toMatchObject({ custody: { spoolBytes: 0, unresolved: false } })
    await expect(service.confirm({ request, fileId: file.id, operationId: op.operationId, input })).resolves.toMatchObject({ state: 'COMMITTED', fileVersion: 2 })
  })
  it('does not execute a second PUT when the reply of the first PUT is lost', async () => {
    let writes = 0
    service = recovery.createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn: async () => { writes++; throw new Error('secret provider URL') } })
    const { op, stage, input } = await staged()
    expect(stage).toMatchObject({ state: 'UNKNOWN', retryable: false })
    const again = await service.stage({ request, fileId: file.id, operationId: op.operationId, input })
    expect(again).toMatchObject({ state: 'UNKNOWN', outcome: 'RECONCILIATION_REQUIRED', retryable: false })
    expect(writes).toBe(1)
    expect(JSON.stringify(again)).not.toMatch(/secret provider URL|s3-business/)
  })
  it('uses scoped HEAD plus exact-version GET to reconcile a lost PUT response without another PUT', async () => {
    const original = service
    let wrote = false
    service = recovery.createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn: async (url, init) => {
      if (init.method === 'PUT') { wrote = true; throw new Error('lost reply') }
      return new Response(init.method === 'HEAD' ? null : bytes, { status: wrote ? 200 : 404, headers: { 'x-amz-version-id': 'recovered-v1' } })
    } })
    const { op } = await staged()
    expect(await service.inspect({ request, fileId: file.id, operationId: op.operationId, input: {} })).toMatchObject({ state: 'STAGED' })
    expect((await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).attempts).toBe(1)
    void original
  })
  it('refuses a committed operation across a restored generation while allowing authorized history', async () => {
    const { op, input } = await staged()
    await db.managedBlobRecoveryInstallationFence.update({ where: { id: 'installation' }, data: { generation: 2 } })
    await expect(service.confirm({ request, fileId: file.id, operationId: op.operationId, input })).rejects.toMatchObject({ status: 409 })
    expect(await service.status({ request, fileId: file.id, operationId: op.operationId })).toMatchObject({ state: 'STAGED' })
  })
  it('cancels a stalled preview, closes owned custody and releases only its confirmed-deleted spool', async () => {
    const op = await prepare(), abort = new AbortController()
    let started
    const entered = new Promise(resolve => { started = resolve })
    const chunks = { [Symbol.asyncIterator]() { return { next() { started(); return new Promise(() => {}) }, return() { return { done: true } } } } }
    const pending = service.preview({ request, fileId: file.id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks, signal: abort.signal })
      .then(value => ({ value }), error => ({ error }))
    await entered; abort.abort()
    expect((await pending).error).toMatchObject({ status: 410 })
    expect(await service.cleanup({ request, fileId: file.id, operationId: op.operationId })).toMatchObject({ custody: { spoolBytes: 0, unresolved: false } })
    expect(putCount).toBe(0)
  }, 5000)
  it('releases unused journal/audit reservations after closure while retaining actual audit custody', async () => {
    const { op, input } = await staged()
    await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    await service.cleanup({ request, fileId: file.id, operationId: op.operationId })
    const fence = await db.managedBlobRecoveryInstallationFence.findUnique({ where: { id: 'installation' } })
    expect(fence.retainedBytes).toBe(20480) // 16 KiB journal + COMMITTED/CLOSED at 2 KiB each
  })
  it('a crashed/late PUT worker cannot attach its receipt after inspection invalidates the claim epoch', async () => {
    let start, release, providerHasBytes = false, puts = 0
    const entered = new Promise(resolve => { start = resolve }), delayed = new Promise(resolve => { release = resolve })
    service = recovery.createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn: async (url, init) => {
      if (init.method === 'PUT') { puts++; start(); await delayed; providerHasBytes = true }
      return new Response(init.method === 'GET' ? bytes : null, { status: init.method !== 'PUT' && !providerHasBytes ? 404 : 200,
        headers: { 'x-amz-version-id': 'late-v1' } })
    } })
    const op = await prepare(), preview = await service.preview({ request, fileId: file.id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks: [bytes] })
    const input = { confirmationBinding: preview.confirmationBinding, expectedOperationVersion: preview.version }
    const pending = service.stage({ request, fileId: file.id, operationId: op.operationId, input }).then(value => ({ value }), error => ({ error }))
    await entered
    await db.managedBlobRecoveryOperation.update({ where: { id: op.operationId }, data: { leaseExpiresAt: new Date(0) } })
    const unknown = await service.inspect({ request, fileId: file.id, operationId: op.operationId, input: {} })
    expect(unknown).toMatchObject({ state: 'UNKNOWN', retryable: false })
    release()
    expect((await pending).error).toMatchObject({ status: 409 })
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
    const inspected = await service.inspect({ request, fileId: file.id, operationId: op.operationId, input: {} })
    expect(inspected).toMatchObject({ state: 'STAGED' })
    expect(puts).toBe(1)
  })
  it('expires resolved metadata after 30 days without deleting or uncharging retained audit', async () => {
    const { op, input } = await staged()
    await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    await service.cleanup({ request, fileId: file.id, operationId: op.operationId })
    await db.managedBlobRecoveryOperation.update({ where: { id: op.operationId }, data: { closedAt: new Date(Date.now() - 31 * 86400000) } })
    expect(await service.maintain()).toMatchObject({ deletedRecords: 1 })
    expect(await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).toBeNull()
    expect(await db.auditEvent.count({ where: { entityId: op.operationId } })).toBe(2)
    expect((await db.managedBlobRecoveryInstallationFence.findUnique({ where: { id: 'installation' } })).retainedBytes).toBe(4096)
  })
  it('disposes an expired preview spool at its byte deadline without granting an attachment', async () => {
    const op = await prepare()
    await service.preview({ request, fileId: file.id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks: [bytes] })
    await db.managedBlobRecoveryOperation.update({ where: { id: op.operationId }, data: { byteDeadline: new Date(0) } })
    expect(await service.maintain()).toMatchObject({ deletedSpools: 1 })
    const row = await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })
    expect(row).toMatchObject({ state: 'ABANDONED', spoolBytes: 0, spoolId: null, unresolved: false, confirmationDigest: null })
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
    expect(putCount).toBe(0)
  })
  it('refuses legacy snapshot export of a reserved ref even if its journal is absent, including tombstones', async () => {
    const { op, input } = await staged()
    await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    await db.managedBlobRecoveryOperation.deleteMany()
    await db.fileAsset.update({ where: { id: file.id }, data: { deletedAt: new Date() } })
    await expect(exportSnapshot({ db })).rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_REQUIRED' })
  })
  it('cancels provider readback beyond the persisted byte witness instead of buffering an unbounded body', async () => {
    let cancelled = false, chunks = 0
    service = recovery.createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn: async (url, init) =>
      new Response(init.method === 'GET' ? new ReadableStream({ pull(controller) { if (chunks++ < 16) controller.enqueue(new Uint8Array(1024)); else controller.close() }, cancel() { cancelled = true } }) : null,
        { status: 200, headers: { 'x-amz-version-id': 'owned-v1' } }) })
    const { stage } = await staged()
    expect(stage).toMatchObject({ state: 'UNKNOWN' })
    expect(cancelled).toBe(true)
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
  }, 5000)
  it('settles the worker custody after revocation during PUT without granting a late stage or rebind', async () => {
    let start, release
    const entered = new Promise(resolve => { start = resolve }), delayed = new Promise(resolve => { release = resolve })
    service = recovery.createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn: async (url, init) => {
      if (init.method === 'PUT') { start(); await delayed }
      return new Response(init.method === 'GET' ? bytes : null, { status: 200, headers: { 'x-amz-version-id': 'owned-v1' } })
    } })
    const op = await prepare(), preview = await service.preview({ request, fileId: file.id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks: [bytes] })
    const pending = service.stage({ request, fileId: file.id, operationId: op.operationId,
      input: { confirmationBinding: preview.confirmationBinding, expectedOperationVersion: preview.version } }).then(value => ({ value }), error => ({ error }))
    await entered
    await db.membership.update({ where: { id: membership.id }, data: { status: 'REVOKED' } })
    release()
    expect((await pending).error).toMatchObject({ status: 404 })
    expect(await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).toMatchObject({ state: 'UNKNOWN', workerId: null, unresolved: true })
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
  })
  it('a revoked persisted session cannot distinguish existing and nonexistent file/operation identities', async () => {
    const op = await prepare()
    await db.session.updateMany({ where: { personId: person.id }, data: { status: 'REVOKED', revokedAt: new Date() } })
    try {
      for (const fileId of [file.id, randomUUID()]) await expect(service.status({ request, fileId, operationId: op.operationId }))
        .rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' })
    } finally { await db.session.updateMany({ where: { personId: person.id }, data: { status: 'ACTIVE', revokedAt: null } }) }
  })
  it('refuses spool cleanup under a different configured data directory without releasing custody', async () => {
    const { op, input } = await staged()
    await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    const different = recovery.createManagedBlobRecoveryService({ db, env, dataDirectory: path.join(root, 'different-target') })
    await expect(different.cleanup({ request, fileId: file.id, operationId: op.operationId })).rejects.toMatchObject({ status: 409 })
    expect((await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).spoolBytes).toBe(8)
    expect(await service.cleanup({ request, fileId: file.id, operationId: op.operationId })).toMatchObject({ custody: { spoolBytes: 0, unresolved: false } })
  })
  it('retains exact custody after a filesystem cleanup failure and returns no raw path/cause', async () => {
    const { op, input } = await staged()
    await service.confirm({ request, fileId: file.id, operationId: op.operationId, input })
    const row = await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })
    const owned = path.join(root, 'managed-blob-recovery-private', row.spoolId)
    await unlink(owned); await mkdir(owned)
    await expect(service.cleanup({ request, fileId: file.id, operationId: op.operationId }))
      .rejects.toMatchObject({ status: 503, message: 'Recovery request refused' })
    expect((await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).spoolBytes).toBe(8)
  })
  it('provider credential rotation does not prevent byte-deadline cleanup of the same private spool root', async () => {
    const op = await prepare()
    await service.preview({ request, fileId: file.id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks: [bytes] })
    await db.managedBlobRecoveryOperation.update({ where: { id: op.operationId }, data: { byteDeadline: new Date(0) } })
    const rotated = recovery.createManagedBlobRecoveryService({ db, env: { ...env, ZURI_ASSET_STORAGE_SECRET_KEY: 'rotated-synthetic-test-secret' }, dataDirectory: root,
      fetchFn: () => { throw new Error('Local custody maintenance must not call a provider') } })
    expect(await rotated.maintain()).toMatchObject({ deletedSpools: 1 })
    expect(await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })).toMatchObject({ spoolId: null, spoolBytes: 0, unresolved: false })
  })
})
