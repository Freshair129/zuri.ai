// @req FR-292, FR-293 — real runtime-role row locks, rollback and snapshot exclusion.
// @spec ADR-115, SEC-008
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { PrismaClient } from '@zuri/prisma-postgres'
import { startEmbeddedPostgres } from '../helpers/embedded-postgres'
import { generateSessionToken, persistSession } from '@/modules/identity/auth-service'
import { createManagedBlobRecoveryService } from '@/modules/project-manager/application/managed-blob-recovery-service'
import { exportSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'
import { createPostgresRecoveryAdapter, loadFrozenSchemaInventory, runProtectedExport, runCleanTargetRestore } from '../../scripts/phase-b-recovery.mjs'
import { extractSnapshot as protectedExtractSnapshot, validateSnapshotRecovery as protectedValidateSnapshot, insertSnapshotIntoEmptyTarget as protectedInsertSnapshot } from '../../scripts/phase-b-recovery-hooks.mjs'
import { makeOperatorViewer } from '../factories/viewer'
import { COMPACT_SECURITY_SQL } from '../../scripts/lib/compact/security.mjs'

const content = Buffer.from('original'), sha256 = '0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5'
const env = { ZURI_SESSION_SECRET: 'native-or2-test-session-secret-at-least-32', ZURI_ASSET_STORAGE_PROVIDER: 's3',
  ZURI_ASSET_EVIDENCE_BUCKET: 'asset-private', ZURI_ASSET_STORAGE_ENDPOINT: 'http://storage.test:9000',
  ZURI_ASSET_STORAGE_ACCESS_KEY: 'test', ZURI_ASSET_STORAGE_SECRET_KEY: 'test' }
let server, admin, runtime, otherRuntime, root, control, observer, writer, service, request, file, owner, membership, staged, confirm, runtimeUrl, confirmArgs, schemaDdl
const clients = []
beforeAll(async () => {
  server = await startEmbeddedPostgres({ label: 'or2-role', database: 'or2_test' })
  control = new pg.Client({ connectionString: server.url }); await control.connect()
  const ddl = execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script'],
    { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  await control.query(ddl)
  schemaDdl = ddl
  // Same fresh Compact security snapshot, not superuser-only acceptance.
  await control.query(COMPACT_SECURITY_SQL)
  const password = randomBytes(24).toString('hex')
  await control.query(`ALTER ROLE zuri_web_login PASSWORD '${password}'`)
  const url = new URL(server.url); url.username = 'zuri_web_login'; url.password = password; url.searchParams.set('connection_limit', '1')
  runtimeUrl = url.href
  admin = new PrismaClient({ datasources: { db: { url: server.url } } }); clients.push(admin)
  runtime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } }); clients.push(runtime)
  otherRuntime = new PrismaClient({ datasources: { db: { url: runtimeUrl } } }); clients.push(otherRuntime)
  observer = new pg.Client({ connectionString: server.url }); await observer.connect()
  writer = new pg.Client({ connectionString: runtimeUrl }); await writer.connect()
  root = await mkdtemp(path.join(tmpdir(), 'zuri-or2-native-'))
}, 120000)
afterAll(async () => {
  try { await writer?.query('ROLLBACK'); await control?.query('ROLLBACK') } finally {
    await Promise.all(clients.map(client => client.$disconnect()))
    await writer?.end(); await observer?.end(); await control?.end(); await server?.stop()
    if (root) await rm(root, { recursive: true, force: true })
  }
}, 120000)
beforeEach(async () => {
  await writer.query('ROLLBACK'); await control.query('ROLLBACK')
  await admin.managedBlobRecoveryOperation.deleteMany(); await admin.managedBlobRecoveryInstallationFence.deleteMany()
  await admin.fileAsset.deleteMany()
  await admin.managedBlobRecoveryInstallationFence.create({ data: { id: 'installation', mode: 'READY' } })
  // Administrative TEST arrangement is explicitly not product-ingestion or
  // operator/whole-installation qualification.
  const id = randomUUID(), portfolio = await admin.portfolio.create({ data: { name: 'OR2', code: 'PF-' + id } })
  const tenant = await admin.tenant.create({ data: { name: 'OR2', code: 'T-' + id, portfolioId: portfolio.id } })
  const business = await admin.business.create({ data: { name: 'OR2', code: 'B-' + id, tenantId: tenant.id } })
  owner = await admin.person.create({ data: { displayName: 'Owner', code: 'P-' + id } })
  membership = await admin.membership.create({ data: { tenantId: tenant.id, businessId: business.id, personId: owner.id, role: 'OWNER' } })
  const sessionId = randomUUID(), token = generateSessionToken(owner.id, { secret: env.ZURI_SESSION_SECRET, sessionId })
  await persistSession({ token, sessionId, personId: owner.id, db: admin, env })
  request = new Request('http://localhost/api/files', { headers: { cookie: 'zuri_session=' + token } })
  file = await admin.fileAsset.create({ data: { tenantId: tenant.id, businessId: business.id, code: 'F-' + id,
    storageKind: 'MANAGED_BLOB', name: 'original.pdf', mime: 'application/pdf', size: 8, sha256,
    blobRef: `s3-business://asset/asset-private/asset-evidence/${tenant.id}/${business.id}/original/file.pdf?versionId=v1` } })
  service = createManagedBlobRecoveryService({ db: runtime, env, dataDirectory: root, fetchFn: async (url, init) =>
    new Response(init.method === 'GET' ? content : null, { status: 200, headers: { 'x-amz-version-id': 'owned-v1' } }) })
  const op = await service.prepare({ request, fileId: file.id, input: { expectedVersion: 1 } })
  const preview = await service.preview({ request, fileId: file.id, operationId: op.operationId, descriptor: JSON.stringify(op.descriptor), chunks: [content] })
  staged = await service.stage({ request, fileId: file.id, operationId: op.operationId, input: { confirmationBinding: preview.confirmationBinding, expectedOperationVersion: preview.version } })
  confirmArgs = { request, fileId: file.id, operationId: op.operationId,
    input: { confirmationBinding: preview.confirmationBinding, expectedOperationVersion: staged.version } }
  confirm = () => service.confirm(confirmArgs)
}, 30000)
async function waitForLock(fragment) {
  const end = Date.now() + 3000
  while (Date.now() < end) {
    const result = await observer.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1`, ['%' + fragment + '%'])
    if (result.rowCount) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Native lock barrier was not observed')
}
it('runs the service as a non-owner, non-bypass runtime under forced RLS and no public grants', async () => {
  const role = await runtime.$queryRawUnsafe('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
  expect(role[0]).toMatchObject({ name: 'zuri_web_login', rolsuper: false, rolbypassrls: false })
  const tables = await observer.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('ManagedBlobRecoveryOperation','ManagedBlobRecoveryInstallationFence')`)
  expect(tables.rows).toHaveLength(2)
  expect(tables.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true)
  const publicAcl = await observer.query(`SELECT count(*)::int AS count FROM pg_class c,
    LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE c.oid IN ('"ManagedBlobRecoveryOperation"'::regclass,'"ManagedBlobRecoveryInstallationFence"'::regclass) AND a.grantee=0`)
  expect(publicAcl.rows[0].count).toBe(0)
  const privileges = await runtime.$queryRawUnsafe(`SELECT has_table_privilege(current_user,'"ManagedBlobRecoveryOperation"','TRUNCATE,REFERENCES,TRIGGER') AS unsafe`)
  expect(privileges[0].unsafe).toBe(false)
  expect(await confirm()).toMatchObject({ state: 'COMMITTED', fileVersion: 2 })
})
it.each(['BUSINESS', 'TENANT'])('revocation wins first (%s): confirm waits and cannot rebind', async scopeType => {
  if (scopeType !== 'BUSINESS') await admin.membership.update({ where: { id: membership.id }, data: { scopeType: scopeType === 'TENANT' ? 'TENANT' : 'BUSINESS', businessId: null } })
  await writer.query('BEGIN')
  await writer.query('UPDATE "Membership" SET "status"=$1,"revokedAt"=clock_timestamp() WHERE "id"=$2', ['REVOKED', membership.id])
  const pending = confirm().then(value => ({ value }), error => ({ error }))
  try { await waitForLock('Membership'); await writer.query('COMMIT') } finally { await writer.query('ROLLBACK') }
  const outcome = await pending
  expect(outcome.error).toMatchObject({ status: 404 })
  expect((await admin.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
  expect((await admin.managedBlobRecoveryOperation.findUnique({ where: { id: staged.operationId } })).state).toBe('STAGED')
})
it.each(['BUSINESS', 'TENANT'])('confirm wins first (%s): native revoker waits for the actual witness lock', async scopeType => {
  if (scopeType !== 'BUSINESS') await admin.membership.update({ where: { id: membership.id }, data: { scopeType: scopeType === 'TENANT' ? 'TENANT' : 'BUSINESS', businessId: null } })
  await control.query('BEGIN'); await control.query('SELECT id FROM "FileAsset" WHERE id=$1 FOR UPDATE', [file.id])
  const pending = confirm().then(value => ({ value }), error => ({ error }))
  let revoke
  try {
    await waitForLock('FileAsset')
    revoke = writer.query('UPDATE "Membership" SET "status"=$1,"revokedAt"=clock_timestamp() WHERE "id"=$2', ['REVOKED', membership.id]).then(() => null, error => error)
    await waitForLock('UPDATE "Membership"')
    await control.query('COMMIT')
  } finally { await control.query('ROLLBACK') }
  const outcome = await pending; expect(await revoke).toBeNull()
  // The commit may lose only its postcommit availability response to revocation;
  // durable metadata/audit must already be committed exactly once.
  if (outcome.error) expect(outcome.error.status).toBe(404)
  expect((await admin.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(2)
  expect(await admin.auditEvent.count({ where: { entityId: staged.operationId, action: 'COMMITTED' } })).toBe(1)
  await expect(confirm()).rejects.toMatchObject({ status: 404 })
})
it('session revocation committed while confirm waits cannot be bypassed by the old cookie', async () => {
  await writer.query('BEGIN'); await writer.query('UPDATE "Session" SET "status"=$1 WHERE "personId"=$2', ['REVOKED', owner.id])
  const pending = confirm().then(value => ({ value }), error => ({ error }))
  try { await waitForLock('Session'); await writer.query('COMMIT') } finally { await writer.query('ROLLBACK') }
  expect((await pending).error).toMatchObject({ status: 401 })
  expect((await admin.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
})
it('actual snapshot export refuses unresolved recovery before extraction', async () => {
  await expect(exportSnapshot({ db: runtime }))
    .rejects.toMatchObject({ status: 409, code: 'MANAGED_BLOB_TRANSFER_REQUIRED' })
  expect(await admin.managedBlobRecoveryOperation.count()).toBe(1)
})
it('actual restore refuses newly created custody without deleting target rows', async () => {
  await admin.managedBlobRecoveryOperation.deleteMany()
  const snapshot = await exportSnapshot({ db: admin })
  await service.prepare({ request, fileId: file.id, input: { expectedVersion: 1 } })
  const before = await admin.fileAsset.findUnique({ where: { id: file.id } })
  await expect(importSnapshot(snapshot, { db: admin, viewer: makeOperatorViewer(), confirm: true }))
    .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_REQUIRED' })
  expect(await admin.fileAsset.findUnique({ where: { id: file.id } })).toEqual(before)
})
it('export owns the native installation fence through the actual extraction', async () => {
  await admin.managedBlobRecoveryOperation.deleteMany()
  await control.query('BEGIN'); await control.query('SELECT id FROM "ManagedBlobRecoveryInstallationFence" WHERE id=$1 FOR UPDATE', ['installation'])
  const extracting = exportSnapshot({ db: admin }).then(value => ({ value }), error => ({ error }))
  let preparing
  try {
    await waitForLock('ManagedBlobRecoveryInstallationFence')
    preparing = service.prepare({ request, fileId: file.id, input: { expectedVersion: 1 } }).then(value => ({ value }), error => ({ error }))
    await control.query('COMMIT')
  } finally { await control.query('ROLLBACK') }
  const extracted = await extracting, prepared = await preparing
  expect(extracted.error).toBeUndefined()
  expect(extracted.value).toMatchObject({ schemaVersion: '1.0' })
  expect(extracted.value.tables).not.toHaveProperty('managedBlobRecoveryOperation')
  // A losing Serializable admission is retried using current state; it may
  // finish after extraction, but cannot enter the immutable snapshot.
  expect(prepared.value).toMatchObject({ state: 'PREPARED' })
})
it('two independent runtime clients cannot commit or audit twice', async () => {
  const otherService = createManagedBlobRecoveryService({ db: otherRuntime, env, dataDirectory: root, fetchFn: async () =>
    new Response(content, { status: 200, headers: { 'x-amz-version-id': 'owned-v1' } }) })
  const pending = [confirm(), otherService.confirm(confirmArgs)].map(p => p.then(value => ({ value }), error => ({ error })))
  const outcomes = await Promise.all(pending)
  expect(outcomes.map(outcome => outcome.value?.state || { status: outcome.error.status, code: outcome.error.code })).toEqual(['COMMITTED', 'COMMITTED'])
  expect(await admin.auditEvent.count({ where: { entityId: staged.operationId, action: 'COMMITTED' } })).toBe(1)
  expect((await admin.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(2)
})
it.each(['Person', 'Business', 'Tenant', 'FileAsset'])('%s native writer wins before confirm: no stale decision or resurrection', async table => {
  const ids = { Person: owner.id, Business: file.businessId, Tenant: file.tenantId, FileAsset: file.id }
  const assignment = table === 'Person' ? '"accessDisabledAt"=clock_timestamp()' : table === 'FileAsset' ? '"deletedAt"=clock_timestamp()' : '"status"=\'ARCHIVED\''
  await writer.query('BEGIN'); await writer.query(`UPDATE "${table}" SET ${assignment} WHERE id=$1`, [ids[table]])
  const pending = confirm().then(value => ({ value }), error => ({ error }))
  try { await waitForLock(table); await writer.query('COMMIT') } finally { await writer.query('ROLLBACK') }
  expect((await pending).error).toBeTruthy()
  expect((await admin.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
  expect(await admin.auditEvent.count({ where: { entityId: staged.operationId, action: 'COMMITTED' } })).toBe(0)
})
it.each(['Membership', 'Session'])('%s expiry during a native file-lock wait is checked using decision time', async table => {
  const id = table === 'Membership' ? membership.id : (await admin.session.findFirst({ where: { personId: owner.id } })).id
  await observer.query(`UPDATE "${table}" SET "expiresAt"=timezone('UTC',clock_timestamp())+interval '250 milliseconds' WHERE id=$1`, [id])
  await control.query('BEGIN'); await control.query('SELECT id FROM "FileAsset" WHERE id=$1 FOR UPDATE', [file.id])
  const pending = confirm().then(value => ({ value }), error => ({ error }))
  try {
    await waitForLock('FileAsset')
    await new Promise(resolve => setTimeout(resolve, 300))
    await control.query('COMMIT')
  } finally { await control.query('ROLLBACK') }
  expect((await pending).error).toMatchObject({ status: table === 'Session' ? 401 : 404 })
  expect((await admin.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
})
it('scope-changing the locked witness cannot authorize its former Business', async () => {
  const other = await admin.business.create({ data: { name: 'Foreign scope', code: 'OTHER-' + randomUUID(), tenantId: file.tenantId } })
  await writer.query('BEGIN')
  await writer.query('UPDATE "Membership" SET "businessId"=$1 WHERE id=$2', [other.id, membership.id])
  const pending = confirm().then(value => ({ value }), error => ({ error }))
  try { await waitForLock('Membership'); await writer.query('COMMIT') } finally { await writer.query('ROLLBACK') }
  expect((await pending).error).toMatchObject({ status: 404 })
  expect((await admin.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
})
it('a cross-order deadlock victim never reports a revocation or recovery that rolled back', async () => {
  await writer.query('BEGIN'); await writer.query('UPDATE "Membership" SET "status"=$1,"revokedAt"=clock_timestamp() WHERE id=$2', ['REVOKED', membership.id])
  const pending = confirm().then(value => ({ value }), error => ({ error }))
  await waitForLock('Membership')
  let revokeCommitted = false
  try {
    await writer.query('UPDATE "Person" SET "displayName"=$1 WHERE id=$2', ['Contending writer', owner.id])
    await writer.query('COMMIT'); revokeCommitted = true
  } catch (error) { expect(['40P01', '40001']).toContain(error.code); await writer.query('ROLLBACK') }
  const outcome = await pending
  const persisted = await admin.fileAsset.findUnique({ where: { id: file.id } })
  if (revokeCommitted) { expect(outcome.error).toBeTruthy(); expect(persisted.version).toBe(1) }
  else if (outcome.value) expect(persisted.version).toBe(2)
  else { expect(outcome.error.status).toBe(503); expect(persisted.version).toBe(1) }
  expect(await admin.auditEvent.count({ where: { entityId: staged.operationId, action: 'COMMITTED' } })).toBe(persisted.version === 2 ? 1 : 0)
})
it('a native revoker lock-timeout victim rolls back its own revocation before recovery may succeed', async () => {
  await writer.query('BEGIN'); await writer.query("SET LOCAL lock_timeout='100ms'")
  await writer.query('UPDATE "Membership" SET "status"=$1,"revokedAt"=clock_timestamp() WHERE id=$2', ['REVOKED', membership.id])
  const pending = confirm().then(value => ({ value }), error => ({ error }))
  await waitForLock('Membership')
  await expect(writer.query('UPDATE "Person" SET "displayName"=$1 WHERE id=$2', ['Blocked revoker', owner.id])).rejects.toMatchObject({ code: '55P03' })
  await writer.query('ROLLBACK')
  expect((await pending).value).toMatchObject({ state: 'COMMITTED' })
  expect((await admin.membership.findUnique({ where: { id: membership.id } })).status).toBe('ACTIVE')
  expect((await admin.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(2)
})
it('concurrent independent admissions cannot overbook the per-actor unresolved quota', async () => {
  const otherService = createManagedBlobRecoveryService({ db: otherRuntime, env, dataDirectory: root })
  const args = { request, fileId: file.id, input: { expectedVersion: 1 } }
  const outcomes = await Promise.all([service.prepare(args), otherService.prepare(args)].map(p => p.then(value => ({ value }), error => ({ error }))))
  expect(outcomes.filter(outcome => outcome.value).length).toBe(1)
  expect(outcomes.find(outcome => outcome.error).error).toMatchObject({ status: 429 })
  expect(await admin.managedBlobRecoveryOperation.count({ where: { actorId: owner.id, unresolved: true } })).toBe(2)
})
it('a successful actual empty-custody restore preserves exclusion through completion and requires new admission', async () => {
  await admin.managedBlobRecoveryOperation.deleteMany()
  const snapshot = await exportSnapshot({ db: admin })
  expect(await importSnapshot(snapshot, { db: admin, viewer: makeOperatorViewer(), confirm: true })).toMatchObject({ restored: true })
  expect(await admin.managedBlobRecoveryInstallationFence.findUnique({ where: { id: 'installation' } }))
    .toMatchObject({ mode: 'NEEDS_ADMISSION', generation: 2, restoreAttemptId: expect.any(String) })
  await expect(service.prepare({ request, fileId: file.id, input: { expectedVersion: 1 } })).rejects.toMatchObject({ status: 503 })
})
it('a crash/failure in the actual restore postpass never resets its durable RESTORING fence', async () => {
  await admin.managedBlobRecoveryOperation.deleteMany()
  const snapshot = await exportSnapshot({ db: admin })
  const row = snapshot.tables.fileAsset.find(row => row.id === file.id)
  row.storageKind = 'LOCAL_FILE'; row.relativePath = 'missing.bin'; row.blobRef = null
  await control.query(`CREATE FUNCTION or2_postpass_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='MISSING' THEN RAISE EXCEPTION 'or2 postpass failure'; END IF; RETURN NEW; END $$`)
  await control.query('CREATE TRIGGER or2_postpass_failure BEFORE UPDATE ON "FileAsset" FOR EACH ROW EXECUTE FUNCTION or2_postpass_failure()')
  try {
    await expect(importSnapshot(snapshot, { db: admin, viewer: makeOperatorViewer(), confirm: true })).rejects.toThrow()
    expect(await admin.managedBlobRecoveryInstallationFence.findUnique({ where: { id: 'installation' } }))
      .toMatchObject({ mode: 'RESTORING', generation: 2 })
  } finally {
    await control.query('DROP TRIGGER or2_postpass_failure ON "FileAsset"'); await control.query('DROP FUNCTION or2_postpass_failure()')
  }
})
it('preserves actual protected offline export in a native READ ONLY transaction', async () => {
  await admin.managedBlobRecoveryOperation.deleteMany()
  const inventory = await loadFrozenSchemaInventory(), adapter = createPostgresRecoveryAdapter({ connectionString: server.url, inventory })
  let readOnly
  try {
    let preparing
    const result = await runProtectedExport({ inventory, adapter, validateSnapshotRecovery: protectedValidateSnapshot,
      extractSnapshot: async ({ tx, adapter }) => {
        readOnly = (await tx.client.query('SHOW transaction_read_only')).rows[0].transaction_read_only
        preparing = service.prepare({ request, fileId: file.id, input: { expectedVersion: 1 } }).then(value => ({ value }), error => ({ error }))
        await waitForLock('pg_advisory_xact_lock')
        return protectedExtractSnapshot({ tx, adapter })
      } })
    expect(readOnly).toBe('on')
    expect(result).toMatchObject({ status: 'EXPORTED', errorCode: null })
    expect((await preparing).value).toMatchObject({ state: 'PREPARED' })
  } finally { await adapter.close() }
})
it.each(['fileAsset', 'projectFile'])('offline restore refuses reserved %s refs before inserting into a fresh native target', async model => {
  await admin.managedBlobRecoveryOperation.deleteMany()
  const suffix = randomUUID()
  const workspace = await admin.workspace.create({ data: { code: 'WS-' + suffix, name: 'Restore scope', scopeType: 'BUSINESS', tenantId: file.tenantId, businessId: file.businessId } })
  const project = await admin.project.create({ data: { code: 'PR-' + suffix, name: 'Restore scope', businessId: file.businessId, workspaceId: workspace.id } })
  const alias = await admin.projectFile.create({ data: { code: 'PF-' + suffix, name: 'Legacy alias', projectId: project.id, mime: file.mime, size: file.size, blobRef: file.blobRef } })
  const snapshot = await exportSnapshot({ db: admin })
  const row = snapshot.tables[model].find(row => row.id === (model === 'fileAsset' ? file.id : alias.id))
  row.blobRef = `s3-business://asset/asset-private/asset-evidence/${file.tenantId}/${file.businessId}/recovery/${randomUUID()}/${'a'.repeat(64)}?versionId=untransferred-v1`
  if (model === 'fileAsset') row.deletedAt = new Date().toISOString()
  const bytes = Buffer.from(JSON.stringify(snapshot)), expectedSnapshotSha256 = createHash('sha256').update(bytes).digest('hex')
  const database = 'or2_refusal_' + randomUUID().replaceAll('-', '')
  await control.query(`CREATE DATABASE "${database}"`)
  const targetUrl = new URL(server.url); targetUrl.pathname = '/' + database
  const target = new pg.Client({ connectionString: targetUrl.href }); await target.connect()
  const inventory = await loadFrozenSchemaInventory(), adapter = createPostgresRecoveryAdapter({ connectionString: targetUrl.href, inventory })
  try {
    await target.query(schemaDdl)
    const result = await runCleanTargetRestore({ snapshotBytes: bytes, expectedSnapshotSha256, inventory, adapter,
      confirmation: 'PHASE_B_EMPTY_TARGET', validateSnapshotRecovery: protectedValidateSnapshot, insertSnapshot: protectedInsertSnapshot })
    expect(result).toMatchObject({ status: 'REFUSED', errorCode: 'MANAGED_BLOB_TRANSFER_REQUIRED' })
    expect((await target.query('SELECT count(*)::int AS count FROM "FileAsset"')).rows[0].count).toBe(0)
    expect((await target.query('SELECT count(*)::int AS count FROM "ProjectFile"')).rows[0].count).toBe(0)
    expect((await target.query('SELECT count(*)::int AS count FROM "AuditEvent"')).rows[0].count).toBe(0)
  } finally { await adapter.close(); await target.end() }
})
