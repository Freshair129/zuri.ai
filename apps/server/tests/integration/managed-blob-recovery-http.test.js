// @req FR-292, FR-293 — authenticated bounded operator transport; no activation.
// @spec ADR-115, SEC-008
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import db from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { generateSessionToken, persistSession } from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'
import { issueApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { createManagedBlobRecoveryService } from '@/modules/project-manager/application/managed-blob-recovery-service'
import { createRecoveryHttpHandler } from '@/modules/project-manager/application/managed-blob-recovery-http'

const env = { ZURI_SESSION_SECRET: 'or3-disposable-session-secret-only', PUBLIC_BASE_URL: 'http://localhost',
  ZURI_ASSET_STORAGE_PROVIDER: 's3', ZURI_ASSET_EVIDENCE_BUCKET: 'asset-private',
  ZURI_ASSET_STORAGE_ENDPOINT: 'http://storage.test:9000', ZURI_ASSET_STORAGE_ACCESS_KEY: 'test',
  ZURI_ASSET_STORAGE_SECRET_KEY: 'test', ZURI_KNOWLEDGE_CATALOG_BUCKET: 'catalog-private',
  ZURI_KNOWLEDGE_STORAGE_BUCKET: 'knowledge-private' }
const content = Buffer.from('original')
const digest = '0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5'
let scope, membership, root, cookie, csrf, file, handler, service, puts, objects
beforeAll(async () => {
  const id = randomUUID(), portfolio = await createPortfolio({ name: 'OR3', code: 'PF-' + id })
  const tenant = await createTenant({ name: 'OR3', code: 'T-' + id, portfolioId: portfolio.id })
  const business = await createBusiness({ name: 'OR3', code: 'B-' + id, tenantId: tenant.id })
  scope = { tenantId: tenant.id, businessId: business.id }
  const person = await db.person.create({ data: { code: 'P-' + id, displayName: 'OR3 owner' } })
  membership = await db.membership.create({ data: { ...scope, personId: person.id, role: 'OWNER' } })
  const sessionId = randomUUID(), token = generateSessionToken(person.id, { sessionId, secret: env.ZURI_SESSION_SECRET })
  await persistSession({ token, sessionId, personId: person.id, db, env })
  cookie = 'zuri_session=' + token
  const request = new Request('http://localhost', { headers: { cookie, origin: env.PUBLIC_BASE_URL } })
  const session = await createSessionPort({ db, env }).read(request)
  csrf = issueApiWriteCsrfToken({ request, session, env }).token
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'zuri-or3-')))
})
afterAll(async () => {
  vi.useRealTimers()
  if (scope) {
    await db.managedBlobRecoveryOperation.deleteMany({ where: scope })
    await db.fileAsset.deleteMany({ where: scope })
    await db.managedBlobRecoveryInstallationFence.deleteMany({ where: { id: 'installation' } })
  }
  if (root) await rm(root, { recursive: true, force: true })
})
beforeEach(async () => {
  puts = 0; objects = new Map()
  await db.managedBlobRecoveryOperation.deleteMany({ where: scope })
  await db.managedBlobRecoveryInstallationFence.deleteMany({ where: { id: 'installation' } })
  // Explicit TEST-only fixture admission; never runtime bootstrap/qualification.
  await db.managedBlobRecoveryInstallationFence.create({ data: { id: 'installation', mode: 'READY', generation: 1 } })
  await db.membership.update({ where: { id: membership.id }, data: { role: 'OWNER' } })
  file = await db.fileAsset.create({ data: { ...scope, code: 'FIL-' + randomUUID(), name: 'original.pdf',
    storageKind: 'MANAGED_BLOB', size: 8, sha256: digest, mime: 'application/pdf',
    blobRef: `s3-business://asset/asset-private/asset-evidence/${scope.tenantId}/${scope.businessId}/original/file.pdf?versionId=v1` } })
  service = createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn: async (url, init) => {
    const key = new URL(url).pathname
    if (init.method === 'PUT') { puts++; objects.set(key, Buffer.from(init.body)); return new Response('', { headers: { 'x-amz-version-id': 'v2' } }) }
    return objects.has(key) ? new Response(init.method === 'HEAD' ? null : objects.get(key), { headers: { 'x-amz-version-id': 'v2' } }) : new Response('', { status: 404 })
  } })
  handler = createRecoveryHttpHandler({ db, env, service })
})
function request(body, headers = {}, method = 'POST') {
  return new Request('http://localhost/api/files/' + file.id + '/recovery-operations', { method,
    headers: { cookie, origin: env.PUBLIC_BASE_URL, 'X-Zuri-API-Write-CSRF': csrf,
      ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(method === 'GET' ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
}
async function call(action, body, operationId, headers) {
  return handler(request(body, headers, action === 'status' ? 'GET' : 'POST'), { fileId: file.id, operationId, action })
}
async function prepared() {
  const response = await call('prepare', { expectedVersion: 1 })
  expect(response.status).toBe(200)
  return response.json()
}
function multipart(op, bytes = content) {
  const form = new FormData()
  form.append('descriptor', JSON.stringify(op.descriptor))
  form.append('content', new Blob([bytes]), 'original.pdf')
  return form
}
it('keeps the ordinary runtime unavailable even with caller activation flags', async () => {
  const closed = createRecoveryHttpHandler({ db, env: { ...env, ZURI_RECOVERY_ENABLED: 'true', NODE_ENV: 'test' } })
  const response = await closed(request({ expectedVersion: 1 }), { fileId: file.id, action: 'prepare' })
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ code: 'MANAGED_BLOB_RECOVERY_NOT_QUALIFIED', retryable: false })
  expect(await db.managedBlobRecoveryOperation.count({ where: scope })).toBe(0)
})
it.each([{ cookie: '' }, { 'X-Zuri-API-Write-CSRF': '' }, { origin: 'https://foreign.test' }])(
  'denies missing session/CSRF or foreign origin before consuming the body %j', async headers => {
    const req = request({ expectedVersion: 1 }, headers)
    const read = vi.spyOn(req.body, 'getReader'), cancel = vi.spyOn(req.body, 'cancel')
    const response = await handler(req, { fileId: file.id, action: 'prepare' })
    expect([401, 403]).toContain(response.status)
    expect(read).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
    expect(puts).toBe(0)
  })
it('denies non-owner preview before consuming upload and gives uniform missing-target response', async () => {
  const op = await prepared()
  await db.membership.update({ where: { id: membership.id }, data: { role: 'MEMBER' } })
  const req = request(multipart(op))
  const read = vi.spyOn(req.body, 'getReader')
  const response = await handler(req, { fileId: file.id, operationId: op.operationId, action: 'preview' })
  expect(response.status).toBe(404); expect(read).not.toHaveBeenCalled()
  const missing = await handler(request(multipart(op)), { fileId: randomUUID(), operationId: randomUUID(), action: 'preview' })
  expect((await response.json()).code).toBe((await missing.json()).code)
  expect(puts).toBe(0)
})
it('runs prepare/preview/stage/explicit confirm and safe replay through HTTP with real custody', async () => {
  const op = await prepared()
  const previewResponse = await call('preview', multipart(op), op.operationId)
  expect(previewResponse.status).toBe(200)
  const preview = await previewResponse.json()
  expect(puts).toBe(0)
  const input = { confirmationBinding: preview.confirmationBinding, expectedOperationVersion: preview.version }
  const stage = await (await call('stage', input, op.operationId)).json()
  expect(stage.state).toBe('STAGED')
  input.expectedOperationVersion = stage.version
  const confirmed = await (await call('confirm', input, op.operationId)).json()
  expect(confirmed).toMatchObject({ state: 'COMMITTED', targetCurrent: true, availability: 'VERIFIED' })
  expect((await call('confirm', input, op.operationId)).status).toBe(200)
  expect(puts).toBe(1)
  const status = await call('status', null, op.operationId)
  expect(status.headers.get('cache-control')).toBe('no-store')
  const text = await status.text()
  expect(text).not.toMatch(/s3-business|confirmationBinding|spoolId|destinationKey|asset-private/)
  expect(JSON.parse(text)).toMatchObject({ availability: 'NOT_CHECKED' })
  expect(await db.auditEvent.count({ where: { entityId: op.operationId, action: 'COMMITTED' } })).toBe(1)
})
it('refuses forged destinations and duplicate JSON keys without PUT', async () => {
  const op = await prepared()
  const bad = multipart(op); bad.append('destinationRef', 's3-business://arbitrary')
  expect((await call('preview', bad, op.operationId)).status).toBe(400)
  // Invalid multipart can consume a claim, so use the same safe GET to inspect
  // custody; it cannot attach bytes or manufacture a preview.
  expect(puts).toBe(0)
  const duplicate = request(null)
  const raw = new Request(duplicate.url, { method: 'POST', headers: duplicate.headers, body: '{"expectedVersion":1,"expectedVersion":1}' })
  expect((await handler(raw, { fileId: file.id, action: 'prepare' })).status).toBe(400)
})

it('refuses a stale preview before reading bytes, and body-supplied destination refs before PUT', async () => {
  const op = await prepared()
  const form = multipart(op)
  await db.fileAsset.update({ where: { id: file.id }, data: { version: 2 } })
  const req = request(form)
  const read = vi.spyOn(req.body, 'getReader')
  expect((await handler(req, { fileId: file.id, operationId: op.operationId, action: 'preview' })).status).toBe(409)
  expect(read).not.toHaveBeenCalled()
  expect((await call('stage', { confirmationBinding: 'A'.repeat(43), expectedOperationVersion: 1,
    destinationRef: 's3-business://arbitrary' }, op.operationId)).status).toBe(400)
  expect(puts).toBe(0)
})

it('does not consume uploads before the persisted spool quota reservation succeeds', async () => {
  const op = await prepared()
  const other = await prepared()
  await db.managedBlobRecoveryOperation.update({ where: { id: other.operationId }, data: { spoolBytes: 256 * 1024 * 1024 } })
  const req = request(multipart(op))
  const read = vi.spyOn(req.body, 'getReader')
  expect((await handler(req, { fileId: file.id, operationId: op.operationId, action: 'preview' })).status).toBe(429)
  expect(read).not.toHaveBeenCalled(); expect(puts).toBe(0)
})

it('accepts arbitrarily split valid multipart, and refuses oversized or compressed bodies', async () => {
  const op = await prepared()
  const original = request(multipart(op)), bytes = new Uint8Array(await original.arrayBuffer())
  let index = 0
  const req = new Request(original.url, { method: 'POST', headers: original.headers,
    body: new ReadableStream({ pull(controller) {
      if (index === bytes.length) controller.close()
      else controller.enqueue(bytes.subarray(index, ++index))
    } }), duplex: 'half' })
  expect((await handler(req, { fileId: file.id, operationId: op.operationId, action: 'preview' })).status).toBe(200)
  expect((await call('prepare', { expectedVersion: 1 }, undefined, { 'content-length': String(65537) })).status).toBe(413)
  expect((await call('prepare', { expectedVersion: 1 }, undefined, { 'content-encoding': 'gzip' })).status).toBe(400)
  expect(puts).toBe(0)
})

it('rotates a lost preview binding only before staging without replacing custody', async () => {
  const op = await prepared()
  const old = await (await call('preview', multipart(op), op.operationId)).json()
  const before = await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })
  const retried = await call('preview', multipart(op), op.operationId)
  expect(retried.status).toBe(200)
  const fresh = await retried.json()
  expect(fresh.confirmationBinding).not.toBe(old.confirmationBinding)
  const after = await db.managedBlobRecoveryOperation.findUnique({ where: { id: op.operationId } })
  expect(after.spoolId).toBe(before.spoolId); expect(after.spoolBytes).toBe(before.spoolBytes)
  expect(after.expiresAt).toEqual(before.expiresAt)
  expect((await call('stage', { confirmationBinding: old.confirmationBinding, expectedOperationVersion: fresh.version }, op.operationId)).status).toBe(409)
  expect((await call('stage', { confirmationBinding: fresh.confirmationBinding, expectedOperationVersion: fresh.version }, op.operationId)).status).toBe(200)
  const late = request(multipart(op)), read = vi.spyOn(late.body, 'getReader')
  expect((await handler(late, { fileId: file.id, operationId: op.operationId, action: 'preview' })).status).toBe(409)
  expect(read).not.toHaveBeenCalled(); expect(puts).toBe(1)
})

it('reclaims expired no-spool preparations without PUT or erasing audit history', async () => {
  const old = await prepared()
  await db.managedBlobRecoveryOperation.update({ where: { id: old.operationId }, data: { expiresAt: new Date(0) } })
  await prepared()
  const expired = await db.managedBlobRecoveryOperation.findUnique({ where: { id: old.operationId } })
  expect(expired).toMatchObject({ state: 'ABANDONED', unresolved: false, spoolId: null, spoolBytes: 0 })
  expect(await db.auditEvent.count({ where: { entityId: old.operationId, action: 'CLOSED' } })).toBe(1)
  expect(puts).toBe(0)
})

it.each(['stalled', 'empty', 'tiny', 'refresh'])('cancels %s upload at the existing deadline without provider IO', async mode => {
  const op = await prepared()
  if (mode === 'refresh') expect((await call('preview', multipart(op), op.operationId)).status).toBe(200)
  let consumed
  const started = new Promise(resolve => { consumed = resolve })
  const cancel = vi.fn()
  const stream = new ReadableStream({
    pull(controller) {
      consumed()
      if (mode === 'empty') controller.enqueue(new Uint8Array())
      else if (mode === 'tiny') controller.enqueue(new Uint8Array([45]))
      else return new Promise(() => {})
    }, cancel,
  }, { highWaterMark: 0 })
  const req = new Request(request(null).url, { method: 'POST', headers: { cookie, origin: env.PUBLIC_BASE_URL,
    'X-Zuri-API-Write-CSRF': csrf, 'content-type': 'multipart/form-data; boundary=bounded-test' }, body: stream, duplex: 'half' })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    const pending = handler(req, { fileId: file.id, operationId: op.operationId, action: 'preview' })
    await started
    await vi.advanceTimersByTimeAsync(30_000)
    expect((await pending).status).toBe(410)
    expect(cancel).toHaveBeenCalledOnce(); expect(puts).toBe(0)
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
  } finally { vi.useRealTimers() }
})

it('keeps the actual Next route wrappers closed and refuses action-path aliases', async () => {
  vi.stubEnv('ZURI_SESSION_SECRET', env.ZURI_SESSION_SECRET)
  vi.stubEnv('PUBLIC_BASE_URL', env.PUBLIC_BASE_URL)
  try {
    const collection = await import('@/app/api/files/[id]/recovery-operations/route.js')
    const operation = await import('@/app/api/files/[id]/recovery-operations/[operationId]/route.js')
    const action = await import('@/app/api/files/[id]/recovery-operations/[operationId]/[action]/route.js')
    const params = Promise.resolve({ id: file.id, operationId: randomUUID(), action: 'prepare' })
    expect((await collection.POST(request({ expectedVersion: 1 }), { params })).status).toBe(503)
    expect((await operation.GET(request(null, {}, 'GET'), { params })).status).toBe(503)
    expect((await action.POST(request({}), { params })).status).toBe(404)
    expect(puts).toBe(0)
  } finally { vi.unstubAllEnvs() }
})

it('refuses replay after authority loss and returns safe UNKNOWN when the PUT response is lost', async () => {
  const op = await prepared()
  const preview = await (await call('preview', multipart(op), op.operationId)).json()
  const input = { confirmationBinding: preview.confirmationBinding, expectedOperationVersion: preview.version }
  await db.membership.update({ where: { id: membership.id }, data: { role: 'MEMBER' } })
  expect((await call('stage', input, op.operationId)).status).toBe(404)
  expect((await call('confirm', input, op.operationId)).status).toBe(404)
  expect(puts).toBe(0)
  await db.membership.update({ where: { id: membership.id }, data: { role: 'OWNER' } })
  const lost = createManagedBlobRecoveryService({ db, env, dataDirectory: root, fetchFn: async () => { throw new Error('private provider error') } })
  const lostHandler = createRecoveryHttpHandler({ db, env, service: lost })
  const response = await lostHandler(request(input), { fileId: file.id, operationId: op.operationId, action: 'stage' })
  expect(response.status).toBe(202)
  expect(await response.json()).toMatchObject({ state: 'UNKNOWN', outcome: 'RECONCILIATION_REQUIRED', retryable: false })
  expect((await call('stage', input, op.operationId)).status).toBe(202)
  expect(puts).toBe(0)
})
