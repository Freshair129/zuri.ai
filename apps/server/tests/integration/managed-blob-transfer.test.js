// @req FR-293 — an exact original-byte backup transfer runs only under source-bound disposable TEST admission.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import db from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { generateSessionToken, hashSessionToken, persistSession, verifySessionToken } from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { issueApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { createManagedBlobBackupTransferHttpHandler }
  from '@/modules/project-manager/application/managed-blob-transfer-http'
import { createManagedBlobBackupTransferRuntimeService }
  from '@/modules/project-manager/application/managed-blob-transfer-http'
import { createManagedBlobBackupTransferService }
  from '@/modules/project-manager/application/managed-blob-transfer-service'
import { GET as getBackupExport } from '../../src/app/api/backup/export/route'
import { createPrivateBusinessObjectStoragePort } from '@/platform/storage/private-business-object-storage'
import { redactManagedBlobTransferActor, completeManagedBlobTransferErasureCleanup } from '@/modules/project-manager/application/managed-blob-transfer-erasure'
import { createManagedBlobTransferSpool } from '@/modules/project-manager/application/managed-blob-transfer-spool'
import { maintainManagedBlobTransferCustody } from '@/modules/project-manager/application/managed-blob-transfer-maintenance'
import { managedBlobTransferConfigHash, MANAGED_BLOB_TRANSFER_PROFILE }
  from '@/modules/project-manager/application/managed-blob-transfer-profile'
import { createManagedBlobTransferTestAdmissionFromEnvironment,
  MANAGED_BLOB_TRANSFER_TEST_ADMISSION_CLAIMS, managedBlobTransferTestTargetFingerprint }
  from '@/modules/project-manager/application/managed-blob-transfer-test-admission'
import { beginManagedBlobTransferRestore }
  from '@/modules/project-manager/application/managed-blob-transfer-repository'
import { canonicalJSON } from '@/modules/project-manager/application/handoff-contract'
import { startCompactBusinessStorage } from '../helpers/compact-business-storage.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
const bytes = Buffer.from('FR-293 original bytes: สินทรัพย์')
const digest = sha(bytes)
const baseEnv = {
  NODE_ENV: 'test', ZURI_SESSION_SECRET: 'fr293-disposable-postgres-transfer-test-secret',
  PUBLIC_BASE_URL: 'http://localhost',
}
const inMemoryStorageEnv = {
  ZURI_ASSET_STORAGE_PROVIDER: 's3', ZURI_ASSET_EVIDENCE_BUCKET: 'asset-private',
  ZURI_ASSET_STORAGE_ENDPOINT: 'http://127.0.0.1:9000', ZURI_ASSET_STORAGE_REGION: 'us-east-1',
  ZURI_ASSET_STORAGE_ACCESS_KEY: 'synthetic-asset-access', ZURI_ASSET_STORAGE_SECRET_KEY: 'synthetic-asset-secret',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER: 's3', ZURI_KNOWLEDGE_CATALOG_BUCKET: 'catalog-private',
  ZURI_KNOWLEDGE_STORAGE_BUCKET: 'knowledge-private', ZURI_KNOWLEDGE_CATALOG_STORAGE_ENDPOINT: 'http://127.0.0.1:9001',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_REGION: 'us-east-1', ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY: 'synthetic-catalog-access',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY: 'synthetic-catalog-secret',
}
let scope, person, root, request, session, viewer, csrf, sourceRef, provider, sourceRows
let env, storageFixture, browserRun

function createProvider() {
  const objects = new Map(), keyToRef = new Map()
  let putCount = 0, readCount = 0
  return {
    objects, keyToRef,
    get putCount() { return putCount },
    get readCount() { return readCount },
    async seed({ purpose, key, content }) {
      const bucket = purpose === 'asset' ? 'asset-private' : 'catalog-private', versionId = 'source-v1'
      const ref = `s3-business://${purpose}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}?versionId=${versionId}`
      const body = Buffer.from(content)
      objects.set(ref, { bytes: body, key, purpose }); keyToRef.set(key, ref)
      return { ref, sha256: sha(body), byteLength: body.length }
    },
    async removeSource({ ref, key }) { objects.delete(ref); keyToRef.delete(key) },
    async hasRef({ ref }) { return objects.has(ref) },
    async readExact({ ref, expectedSha256, expectedByteLength }) {
      const item = objects.get(ref)
      if (!item || item.bytes.length !== expectedByteLength || sha(item.bytes) !== expectedSha256) {
        throw Object.assign(new Error('provider detail must not escape'), { status: 404, code: 'TEST_OBJECT_MISSING' })
      }
      return Buffer.from(item.bytes)
    },
    factory: purpose => ({
      async get({ ref, expectedSha256, expectedByteLength }) {
        readCount++
        const item = objects.get(ref)
        if (!item || item.bytes.length !== expectedByteLength || sha(item.bytes) !== expectedSha256) {
          throw Object.assign(new Error('provider detail must not escape'), { status: 404, code: 'TEST_OBJECT_MISSING' })
        }
        return Buffer.from(item.bytes)
      },
      async put({ key, content }) {
        putCount++
        const bucket = purpose === 'asset' ? 'asset-private' : 'catalog-private'
        const versionId = `test-v${putCount}`
        const ref = `s3-business://${purpose}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}?versionId=${versionId}`
        const body = Buffer.from(content)
        objects.set(ref, { bytes: body, key, purpose })
        keyToRef.set(key, ref)
        return { ref, sha256: sha(body), byteLength: body.length }
      },
      async recover({ key }) {
        const ref = keyToRef.get(key)
        if (!ref) return null
        const item = objects.get(ref)
        return { ref, sha256: sha(item.bytes), byteLength: item.bytes.length }
      },
    }),
  }
}

function createConfiguredProvider(storageEnv) {
  const ports = Object.fromEntries(['asset', 'catalog'].map(purpose => [purpose,
    createPrivateBusinessObjectStoragePort(purpose, storageEnv)]))
  let putCount = 0, readCount = 0
  return {
    get putCount() { return putCount },
    get readCount() { return readCount },
    async seed({ purpose, key, content }) { return ports[purpose].put({ key, content }) },
    async removeSource({ purpose, ref, scope: objectScope }) {
      return ports[purpose].remove({ ref, tenantId: objectScope.tenantId, businessId: objectScope.businessId })
    },
    async hasRef({ purpose, ref, scope: objectScope, expectedSha256, expectedByteLength }) {
      try {
        await ports[purpose].get({ ref, tenantId: objectScope.tenantId, businessId: objectScope.businessId,
          expectedSha256, expectedByteLength })
        return true
      } catch (error) {
        if (error?.status === 404) return false
        throw error
      }
    },
    async readExact({ purpose, ref, scope: objectScope, expectedSha256, expectedByteLength }) {
      return ports[purpose].get({ ref, tenantId: objectScope.tenantId, businessId: objectScope.businessId,
        expectedSha256, expectedByteLength })
    },
    factory: (purpose, maxReadBytes) => {
      const port = createPrivateBusinessObjectStoragePort(purpose, storageEnv,
        maxReadBytes === undefined ? {} : { maxReadBytes })
      return {
        get(input) { readCount++; return port.get(input) },
        put(input) { putCount++; return port.put(input) },
        recover(input) { return port.recover(input) },
      }
    },
  }
}

async function startBackupPage({ service, runtimeEnv, cookie }) {
  let bundle, origin, browserEnv, transferHandler, browser
  let previewResult = null, exportResult = null, packageStatus = null, confirmStatuses = []
  const requests = [], pageErrors = [], consoleErrors = []
  const aliases = {
    name: 'fr293-backup-page-aliases',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@\/context\/ScopeContext$/ }, () => ({ path: 'scope-shim', namespace: 'fr293-test' }))
      buildApi.onLoad({ filter: /.*/, namespace: 'fr293-test' }, () => ({
        contents: 'export function useScope() { return { refresh: async () => {} } }', loader: 'js',
      }))
      buildApi.onResolve({ filter: /^@\// }, args => {
        const base = path.resolve(process.cwd(), 'src', args.path.slice(2))
        const candidates = [...['.js', '.jsx', '.mjs', '.ts', '.tsx'].map(extension => base + extension),
          ...['index.js', 'index.jsx', 'index.mjs', 'index.ts', 'index.tsx'].map(name => path.join(base, name))]
        const resolved = candidates.find(candidate => existsSync(candidate))
        return resolved ? { path: resolved } : null
      })
    },
  }
  bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import BackupPage from './src/app/(pm)/backup/page.jsx';
    createRoot(document.getElementById('root')).render(React.createElement(BackupPage));`,
  resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  plugins: [aliases], define: { 'process.env': '{"NODE_ENV":"production"}' } })
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.method === 'GET' && incoming.url === '/') {
        outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        outgoing.end('<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>')
        return
      }
      if (incoming.method === 'GET' && incoming.url === '/bundle.js') {
        outgoing.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        outgoing.end(bundle.outputFiles[0].text)
        return
      }
      const url = new URL(incoming.url, origin)
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      const controller = new AbortController()
      incoming.on('aborted', () => controller.abort())
      const init = { method: incoming.method, headers, signal: controller.signal }
      if (!['GET', 'HEAD'].includes(incoming.method)) { init.body = Readable.toWeb(incoming); init.duplex = 'half' }
      const req = new Request(url, init)
      const observation = { method: incoming.method, path: url.pathname + url.search, status: null, code: null }
      requests.push(observation)
      let response
      if (url.pathname === '/api/auth/csrf') {
        const current = await createSessionPort({ db, env: browserEnv }).read(req)
        response = Response.json(issueApiWriteCsrfToken({ request: req, session: current, env: browserEnv }))
      } else if (url.pathname === '/api/backup/export') {
        response = await getBackupExport(req)
      } else if (url.pathname.startsWith('/api/backup/transfers')) {
        const parts = url.pathname.slice('/api/backup/transfers'.length).split('/').filter(Boolean)
        const action = !parts.length ? 'current' : ['export', 'preview'].includes(parts[0]) ? parts[0]
          : parts[1] || 'status'
        const jobId = ['current', 'export', 'preview'].includes(action) ? undefined : parts[0]
        response = await transferHandler(req, { action, jobId })
        if (action === 'preview') previewResult = await response.clone().json().catch(() => null)
        if (action === 'export') exportResult = await response.clone().json().catch(() => null)
        if (action === 'package') packageStatus = response.status
        if (action === 'confirm') confirmStatuses.push(response.status)
      } else if (url.pathname === '/api/scope') {
        response = Response.json({ portfolios: [], tenants: [], businesses: [], workspaces: [], projects: [] })
      } else response = Response.json({ error: 'Not found' }, { status: 404 })
      observation.status = response.status
      if ((response.headers.get('content-type') || '').includes('application/json')) {
        observation.code = (await response.clone().json().catch(() => null))?.code || null
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' })
      outgoing.end('{"error":"TEST_BROWSER_HANDLER_FAILED"}')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  browserEnv = { ...runtimeEnv, PUBLIC_BASE_URL: origin }
  vi.stubEnv('ZURI_SESSION_SECRET', runtimeEnv.ZURI_SESSION_SECRET)
  transferHandler = createManagedBlobBackupTransferHttpHandler({ db, env: browserEnv, service })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.addCookies([{ name: 'zuri_session', value: cookie.split('=', 2)[1], url: origin }])
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('dialog', dialog => dialog.accept())
  try { await page.goto(origin, { timeout: 5_000 }) } catch (error) {
    throw new Error(`Backup UI page did not load: ${JSON.stringify({ error: error.message, requests, pageErrors, consoleErrors })}`)
  }
  try { await page.getByRole('button', { name: /Download snapshot/i }).waitFor({ timeout: 5_000 }) } catch (error) {
    throw new Error(`Backup UI did not render: ${JSON.stringify({ error: error.message, requests, pageErrors, consoleErrors, text: await page.locator('body').innerText() })}`)
  }
  return { page, origin,
    get previewResult() { return previewResult }, get exportResult() { return exportResult },
    get packageStatus() { return packageStatus }, get confirmStatuses() { return confirmStatuses },
    get requests() { return requests }, get pageErrors() { return pageErrors }, get consoleErrors() { return consoleErrors },
    async close() { await browser.close(); await new Promise(resolve => server.close(resolve)) },
  }
}

async function waitForTransferJob(handler, cookie, jobId, expectedState) {
  const deadline = Date.now() + 10_000
  let latest
  while (Date.now() < deadline) {
    const response = await handler(new Request(`http://localhost/api/backup/transfers/${jobId}`, { headers: { cookie } }),
      { action: 'status', jobId })
    latest = (await response.json()).job
    if (latest?.state === expectedState) return latest
    if (['FAILED', 'ABANDONED'].includes(latest?.state)) throw new Error(`Transfer job ended as ${latest.state}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const entries = await db.managedBlobBackupTransferEntry.findMany({ where: { jobId },
    select: { state: true, attempts: true, targetRef: true, receiptJson: true, unresolved: true } })
  throw new Error(`Transfer job did not reach ${expectedState}; last job was ${JSON.stringify({ job: latest, entries })}`)
}

async function waitForTerminalTransferJob(handler, cookie, jobId) {
  const deadline = Date.now() + 10_000
  let latest
  while (Date.now() < deadline) {
    const response = await handler(new Request(`http://localhost/api/backup/transfers/${jobId}`,
      { headers: { cookie } }), { action: 'status', jobId })
    latest = (await response.json()).job
    if (['COMPLETE', 'FAILED', 'ABANDONED'].includes(latest?.state)) return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`Transfer job did not become terminal; last job was ${JSON.stringify(latest)}`)
}

async function signTestAdmissionInHarness(claims, admissionFile, publicKeyFile) {
  const helper = fileURLToPath(new URL('../helpers/managed-blob-transfer-test-signer.mjs', import.meta.url))
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]))
  const child = spawn(process.execPath, [helper, root, admissionFile, publicKeyFile], {
    cwd: process.cwd(), env, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true,
  })
  let diagnostics = ''
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-1500) })
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve()
      : reject(new Error(`TEST_ADMISSION_SIGNER_FAILED: ${diagnostics.trim() || `exit ${code}`}`)))
  })
  child.stdin.end(canonicalJSON(claims))
  await completed
  return child.pid
}

describe('FR-293 PM managed-blob backup transfer on disposable PostgreSQL', () => {
  beforeAll(async () => {
    const id = randomUUID()
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'zuri-fr293-transfer-')))
    const useRealProvider = process.env.ZURI_FR293_REAL_PROVIDER_TEST === '1'
    if (useRealProvider) storageFixture = await startCompactBusinessStorage()
    env = { ...baseEnv, ...(storageFixture?.env || inMemoryStorageEnv) }
    provider = useRealProvider ? createConfiguredProvider(env) : createProvider()
    const portfolio = await createPortfolio({ name: 'FR-293 disposable', code: `PF-${id}` })
    const tenant = await createTenant({ name: 'FR-293 disposable', portfolioId: portfolio.id, code: `TEN-${id}` })
    const business = await createBusiness({ name: 'FR-293 disposable', tenantId: tenant.id, code: `BUS-${id}` })
    const workspace = await createWorkspace({ code: `WS-${id}`, name: 'FR-293 TEST', scopeType: 'BUSINESS',
      tenantId: tenant.id, businessId: business.id })
    scope = { tenantId: tenant.id, businessId: business.id, workspaceId: workspace.id }
    const project = await db.project.create({ data: { code: `PRJ-${id}`, name: 'FR-293 synthetic project',
      businessId: business.id, workspaceId: workspace.id } })
    person = await db.person.create({ data: { code: `PER-${id}`, displayName: 'Synthetic transfer operator' } })
    await db.platformGrant.create({ data: { personId: person.id, capability: 'OPERATOR', status: 'ACTIVE', standing: true } })
    const sessionId = randomUUID(), token = generateSessionToken(person.id, { secret: env.ZURI_SESSION_SECRET, sessionId })
    await persistSession({ token, sessionId, personId: person.id, db, env })
    request = new Request('http://localhost/api/backup/transfers', { headers: { cookie: `zuri_session=${token}`,
      origin: env.PUBLIC_BASE_URL } })
    session = await createSessionPort({ db, env }).read(request)
    csrf = issueApiWriteCsrfToken({ request, session, env }).token
    viewer = await resolveRequestViewer(request, { sessionPort: { read: async () => session } })
    expect(viewer).toMatchObject({ principal: { id: person.id }, isOperator: true })

    const sourceObjectId = randomUUID()
    const key = `asset-evidence/${tenant.id}/${business.id}/recovery/${sourceObjectId}/${digest}`
    sourceRef = (await provider.seed({ purpose: 'asset', key, content: bytes })).ref
    const asset = await db.fileAsset.create({ data: { code: `FIL-${id}`, tenantId: tenant.id, businessId: business.id,
      projectId: project.id, storageKind: 'MANAGED_BLOB', blobRef: sourceRef, name: 'evidence.bin',
      mime: 'application/octet-stream', size: bytes.length, sha256: digest, status: 'ACTIVE' } })
    const alias = await db.projectFile.create({ data: { code: `PFL-${id}`, projectId: project.id, name: 'legacy alias',
      mime: asset.mime, size: bytes.length, blobRef: sourceRef } })
    const localAsset = await db.fileAsset.create({ data: { code: `LOCAL-${id}`, tenantId: tenant.id, businessId: business.id,
      projectId: project.id, storageKind: 'LOCAL_FILE', relativePath: 'test-only/postpass-failure.bin',
      name: 'postpass-failure.bin', mime: 'application/octet-stream', size: 0, status: 'ACTIVE' } })
    sourceRows = { assetId: asset.id, aliasId: alias.id, localAssetId: localAsset.id, projectId: project.id }

    await db.managedBlobRecoveryInstallationFence.deleteMany()
    await db.managedBlobRecoveryInstallationFence.create({ data: { id: 'installation', mode: 'READY', generation: 1 } })
    provider.sourceKey = key
  })

  afterAll(async () => {
    if (browserRun) await browserRun.close()
    vi.unstubAllEnvs()
    if (root) await rm(root, { recursive: true, force: true })
    if (storageFixture) await storageFixture.close()
  })

  it('reclaims a crashed PREPARED preview after its durable upload lease expires', async () => {
    const jobId = randomUUID(), expired = new Date(Date.now() - 1)
    const uploadPath = path.join(root, 'managed-blob-transfer-private', `${jobId}.upload`)
    await mkdir(path.dirname(uploadPath), { recursive: true, mode: 0o700 })
    await writeFile(uploadPath, Buffer.from('partial TAR left by crashed preview'), { mode: 0o600 })
    try {
      await db.managedBlobBackupTransferJob.create({ data: { id: jobId, actorId: person.id,
        kind: 'RESTORE', state: 'PREPARED', generation: 1, targetConfigHash: '9'.repeat(64),
        spoolId: jobId, spoolReservedBytes: 1024, expiresAt: expired, byteDeadline: expired,
        workerId: 'interrupted-preview-worker', leaseExpiresAt: expired, unresolved: true } })

      const result = await maintainManagedBlobTransferCustody({ db, dataDirectory: root })
      expect(result).toMatchObject({ examined: 1, payloadsRemoved: 1, retainedForReconciliation: 0 })
      expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: jobId } }))
        .toMatchObject({ state: 'ABANDONED', unresolved: false, cleanupState: 'COMPLETE', spoolId: null,
          spoolReservedBytes: 0 })
      expect(existsSync(uploadPath)).toBe(false)
      expect(await db.managedBlobBackupTransferJob.count({ where: { id: jobId, unresolved: true } })).toBe(0)
    } finally {
      await db.managedBlobBackupTransferEntry.deleteMany({ where: { jobId } })
      await db.managedBlobBackupTransferJob.deleteMany({ where: { id: jobId } })
    }
  })

  it.skipIf(db._engineConfig.activeProvider !== 'postgresql')('exports every alias and original byte, refuses absent admission before provider writes, then replace-restores only TEST data', async () => {
    expect(db._engineConfig.activeProvider).toBe('postgresql')
    const runtimeEnv = { ...env, NODE_ENV: 'production', ZURI_BUILD_REVISION: 'a'.repeat(40),
      ZURI_MANAGED_BLOB_TRANSFER_DATA_DIRECTORY: root,
      ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE: path.join(root, 'test-admission.json'),
      ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_PUBLIC_KEY_FILE: path.join(root, 'test-admission-public.pem') }
    let exportAuditPresentAtProviderRead = false, restoreAuditPresentAtProviderWrite = false
    let loseFirstRestorePutResponse = false
    const auditedStorageFactory = (purpose, maxReadBytes) => {
      const port = provider.factory(purpose, maxReadBytes)
      return { ...port, async get(input) {
        const audit = await db.auditEvent.findFirst({ where: { entityType: 'OPERATOR_ACTION', entityId: 'local',
          action: 'BACKUP_EXPORT', actorId: person.id }, select: { id: true } })
        exportAuditPresentAtProviderRead ||= Boolean(audit)
        expect(audit).toBeTruthy()
        return port.get(input)
      }, async put(input) {
        const audit = await db.auditEvent.findFirst({ where: { entityType: 'OPERATOR_ACTION', entityId: 'local',
          action: 'TRANSFER_RESTORE_CONFIRM', actorId: person.id }, select: { id: true } })
        restoreAuditPresentAtProviderWrite ||= Boolean(audit)
        expect(audit).toBeTruthy()
        const receipt = await port.put(input)
        if (loseFirstRestorePutResponse) {
          loseFirstRestorePutResponse = false
          throw new Error('simulated worker interruption after provider write')
        }
        return receipt
      } }
    }
    const service = createManagedBlobBackupTransferRuntimeService({ db, env: runtimeEnv, storageFactory: auditedStorageFactory })
    const handler = createManagedBlobBackupTransferHttpHandler({ db, env: runtimeEnv, service })
    const post = (path, body, contentType = 'application/json') => new Request(`http://localhost/api/backup/transfers${path}`, {
      method: 'POST', headers: { cookie: request.headers.get('cookie'), origin: runtimeEnv.PUBLIC_BASE_URL,
        'X-Zuri-API-Write-CSRF': csrf, 'content-type': contentType }, body,
    })
    const unauthorizedResume = vi.fn(() => Promise.resolve())
    const deniedCurrent = vi.fn(async () => { throw Object.assign(new Error('operator required'), { status: 403, code: 'AUTH_REQUIRED' }) })
    const unauthorizedHandler = createManagedBlobBackupTransferHttpHandler({ db, env: runtimeEnv,
      service: { resumePendingExports: unauthorizedResume, current: deniedCurrent } })
    const unauthorizedCurrentResponse = await unauthorizedHandler(new Request('http://localhost/api/backup/transfers', {
      headers: { cookie: request.headers.get('cookie') },
    }), { action: 'current', requestViewerResolver: async () => ({ ...viewer, isOperator: false }) })
    expect(unauthorizedCurrentResponse.status).toBe(403)
    expect(deniedCurrent).toHaveBeenCalledOnce()
    expect(unauthorizedResume).not.toHaveBeenCalled()
    const forged = new Request('http://localhost/api/backup/transfers/export', { method: 'POST',
      headers: { cookie: request.headers.get('cookie'), origin: runtimeEnv.PUBLIC_BASE_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ format: 'compact-managed-blob-backup.v1', includeBinaryContent: false, expectedGeneration: 1 }) })
    const readForgedBody = vi.spyOn(forged.body, 'getReader')
    const csrfRefusal = await handler(forged, { action: 'export' })
    expect(csrfRefusal.status).toBe(403)
    expect(readForgedBody).not.toHaveBeenCalled()
    expect(await db.managedBlobBackupTransferJob.count()).toBe(0)

    const holdKeyId = randomUUID()
    await db.legalHoldArchiveKey.create({ data: { id: holdKeyId, tenantId: scope.tenantId,
      legalHoldId: randomUUID(), heldCustomerId: randomUUID(), kekId: 'test-kek', wrappedDek: 'test-wrapped-key' } })
    const heldExport = await service.exportPackage({ request, viewer, session, expectedGeneration: 1 })
    const heldExportResult = await waitForTerminalTransferJob(handler, request.headers.get('cookie'), heldExport.jobId)
    expect(heldExportResult).toMatchObject({ state: 'FAILED', outcome: 'MANAGED_BLOB_TRANSFER_RETENTION_UNPROVEN' })
    expect(provider.readCount).toBe(0)
    await db.legalHoldArchiveKey.delete({ where: { id: holdKeyId } })

    let signalStaleGet, releaseStaleGet, signalStaleGetFinished
    const staleGetStarted = new Promise(resolve => { signalStaleGet = resolve })
    const staleGetRelease = new Promise(resolve => { releaseStaleGet = resolve })
    const staleGetFinished = new Promise(resolve => { signalStaleGetFinished = resolve })
    const interruptedExporter = createManagedBlobBackupTransferService({ db, env: runtimeEnv, dataDirectory: root,
      sourceRevision: () => 'a'.repeat(40), storageFactory: (purpose, maxReadBytes) => {
        const port = provider.factory(purpose, maxReadBytes)
        return { ...port, async get(input) {
          signalStaleGet()
          await staleGetRelease
          const result = await port.get(input)
          signalStaleGetFinished()
          return result
        } }
      } })
    const interruptedExport = await interruptedExporter.exportPackage({ request, viewer, session, expectedGeneration: 1 })
    await staleGetStarted
    const initialStaleExportRow = await db.managedBlobBackupTransferJob.findUnique({ where: { id: interruptedExport.jobId } })
    expect(initialStaleExportRow.workerStartedAt).toBeInstanceOf(Date)
    const staleWorkerStart = new Date(Date.now() - MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs - 60_000)
    await db.managedBlobBackupTransferJob.update({ where: { id: interruptedExport.jobId }, data: {
      createdAt: staleWorkerStart,
      expiresAt: new Date(staleWorkerStart.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.confirmationTtlMs),
      byteDeadline: new Date(staleWorkerStart.getTime() + MANAGED_BLOB_TRANSFER_PROFILE.byteRetentionMs),
      workerStartedAt: staleWorkerStart,
      leaseExpiresAt: staleWorkerStart,
    } })
    const staleExportRow = await db.managedBlobBackupTransferJob.findUnique({ where: { id: interruptedExport.jobId } })
    expect(staleExportRow.byteDeadline.getTime()).toBeGreaterThan(Date.now())
    const resumedExporter = createManagedBlobBackupTransferService({ db, env: runtimeEnv, dataDirectory: root,
      sourceRevision: () => 'a'.repeat(40), storageFactory: provider.factory })
    expect(await resumedExporter.resumePendingExports({ actorId: person.id })).toMatchObject({ resumed: 1 })
    const resumedExport = await waitForTransferJob(handler, request.headers.get('cookie'), interruptedExport.jobId, 'COMPLETE')
    releaseStaleGet()
    await staleGetFinished
    await new Promise(resolve => setTimeout(resolve, 50))
    const completedExport = await db.managedBlobBackupTransferJob.findUnique({ where: { id: interruptedExport.jobId } })
    expect(completedExport.state).toBe('COMPLETE')
    expect(completedExport.epoch).toBeGreaterThan(staleExportRow.epoch)
    expect(resumedExport.state).toBe('COMPLETE')
    expect(await resumedExporter.abandon({ request, viewer, session, jobId: interruptedExport.jobId,
      expectedJobVersion: resumedExport.jobVersion })).toMatchObject({ state: 'ABANDONED' })

    const readsBeforeBrowserRun = provider.readCount
    browserRun = await startBackupPage({ service, runtimeEnv, cookie: request.headers.get('cookie') })
    const downloadPromise = browserRun.page.waitForEvent('download', { timeout: 10_000 }).catch(() => null)
    await browserRun.page.getByRole('button', { name: /Download snapshot/i }).click()
    const download = await downloadPromise
    if (!download) throw new Error(`Backup UI did not download its transfer package: ${JSON.stringify({
      requests: browserRun.requests, pageErrors: browserRun.pageErrors,
      consoleErrors: browserRun.consoleErrors,
      text: await browserRun.page.locator('body').innerText(),
    })}`)
    expect(download.suggestedFilename()).toMatch(/^zuri-managed-blob-backup-[0-9a-f-]+\.tar$/)
    const exportedId = download.suggestedFilename().match(/^zuri-managed-blob-backup-([0-9a-f-]+)\.tar$/)[1]
    const packageBytes = await readFile(await download.path())
    expect(browserRun.exportResult).toMatchObject({ job: { kind: 'EXPORT', state: 'COPYING', generation: 1 } })
    expect(browserRun.packageStatus).toBe(200)
    const acceptedExport = browserRun.exportResult.job
    expect(acceptedExport).toMatchObject({ kind: 'EXPORT', state: 'COPYING', generation: 1 })
    const exportedRecord = await db.managedBlobBackupTransferJob.findUnique({ where: { id: exportedId } })
    expect(exportedRecord).toMatchObject({ id: acceptedExport.jobId, state: 'COMPLETE', outcomeJson: expect.stringContaining('COMPLETE') })
    expect(sha(packageBytes)).toBe(exportedRecord.packageSha256)
    const recoveredDownloadPromise = browserRun.page.waitForEvent('download', { timeout: 10_000 }).catch(() => null)
    await browserRun.page.reload({ waitUntil: 'domcontentloaded' })
    const recoveredDownload = await recoveredDownloadPromise
    expect(recoveredDownload?.suggestedFilename()).toBe(download.suggestedFilename())
    expect(await readFile(await recoveredDownload.path())).toEqual(packageBytes)
    const currentResponse = await handler(new Request('http://localhost/api/backup/transfers', {
      headers: { cookie: request.headers.get('cookie') },
    }), { action: 'current' })
    expect((await currentResponse.json()).jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobId: acceptedExport.jobId, kind: 'EXPORT' }),
    ]))
    expect(exportAuditPresentAtProviderRead).toBe(true)
    const exported = await waitForTransferJob(handler, request.headers.get('cookie'), acceptedExport.jobId, 'COMPLETE')
    const packageResponse = await handler(new Request(`http://localhost/api/backup/transfers/${exported.jobId}/package`, {
      headers: { cookie: request.headers.get('cookie') },
    }), { action: 'package', jobId: exported.jobId })
    expect(packageResponse.status).toBe(200)
    expect(packageResponse.headers.get('content-type')).toBe('application/x-tar')
    expect(Buffer.from(await packageResponse.arrayBuffer())).toEqual(packageBytes)
    expect(provider.readCount).toBe(readsBeforeBrowserRun + 1)
    const statusResponse = await handler(new Request(`http://localhost/api/backup/transfers/${exported.jobId}`,
      { headers: { cookie: request.headers.get('cookie') } }), { action: 'status', jobId: exported.jobId })
    expect(statusResponse.headers.get('cache-control')).toBe('no-store')
    expect(await statusResponse.json()).toMatchObject({ job: { state: 'COMPLETE', outcome: 'COMPLETE' } })
    const abandon = await handler(post(`/${exported.jobId}/abandon`, JSON.stringify({ expectedJobVersion: exported.jobVersion })),
      { action: 'abandon', jobId: exported.jobId })
    const abandoned = await abandon.json()
    const abandonCurrent = await db.managedBlobBackupTransferJob.findUnique({ where: { id: exported.jobId } })
    expect(abandon.status, JSON.stringify({ abandoned, expectedJobVersion: exported.jobVersion,
      currentVersion: abandonCurrent?.version, state: abandonCurrent?.state, spoolId: abandonCurrent?.spoolId,
      cleanupState: abandonCurrent?.cleanupState })).toBe(200)
    expect(abandoned.job).toMatchObject({ state: 'ABANDONED' })

    const sentinel = await db.fileAsset.create({ data: { code: `SENTINEL-${randomUUID()}`, tenantId: scope.tenantId,
      businessId: scope.businessId, storageKind: 'LOCAL_FILE', relativePath: 'test-only/sentinel.bin',
      name: 'must be replaced', mime: 'application/octet-stream', size: 0 } })
    await provider.removeSource({ purpose: 'asset', ref: sourceRef, key: provider.sourceKey, scope })

    let signalRemove, releaseRemove
    const removeStarted = new Promise(resolve => { signalRemove = resolve })
    const removeGate = new Promise(resolve => { releaseRemove = resolve })
    const realSpool = createManagedBlobTransferSpool(root)
    let raceJobId = null
    const gatedSpool = { write: (...args) => realSpool.write(...args), read: (...args) => realSpool.read(...args),
      remove: async id => { if (id === raceJobId) { signalRemove(); await removeGate } return realSpool.remove(id) },
      removeArtifact: (...args) => realSpool.removeArtifact(...args) }
    const raceService = createManagedBlobBackupTransferService({ db, env: runtimeEnv, dataDirectory: root,
      sourceRevision: () => 'a'.repeat(40), storageFactory: provider.factory, spool: gatedSpool })
    async function* packageChunks() { yield packageBytes }
    const racePreview = await raceService.previewPackage({ request, viewer, session,
      chunks: packageChunks(), contentLength: packageBytes.length })
    raceJobId = racePreview.jobId
    const abandoningPreview = raceService.abandon({ request, viewer, session, jobId: racePreview.jobId,
      expectedJobVersion: racePreview.jobVersion })
    try {
      await removeStarted
      expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: racePreview.jobId } }))
        .toMatchObject({ state: 'ABANDONED', unresolved: true, cleanupState: 'ABANDON_PENDING' })
      await expect(raceService.confirm({ request, viewer, session, jobId: racePreview.jobId,
        input: { confirmationBinding: racePreview.confirmationBinding, expectedJobVersion: racePreview.jobVersion } }))
        .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_CONFIRMATION_INVALID' })
      expect(provider.putCount).toBe(0)
    } finally { releaseRemove() }
    expect(await abandoningPreview).toMatchObject({ state: 'ABANDONED', cleanupPending: false })
    expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: racePreview.jobId } }))
      .toMatchObject({ state: 'ABANDONED', unresolved: false, cleanupState: 'COMPLETE', spoolId: null })

    await browserRun.page.locator('input[type="file"]').setInputFiles({ name: 'managed-backup.tar',
      mimeType: 'application/x-tar', buffer: packageBytes })
    await browserRun.page.getByRole('button', { name: /Preview package/i }).click()
    await browserRun.page.getByText('Kind / state: RESTORE / PREVIEWED', { exact: false }).waitFor({ timeout: 5_000 })
    expect(browserRun.previewResult).toMatchObject({ job: { kind: 'RESTORE', state: 'PREVIEWED' } })
    const preview = browserRun.previewResult.job
    expect(preview).toMatchObject({ kind: 'RESTORE', state: 'PREVIEWED', generation: 1,
      testAdmissionCheckEnabled: true, counts: { transferEntries: 1, originalBytes: bytes.length } })
    expect(await browserRun.page.locator('body').innerText()).toContain(
      'This preview is not authorization. The server will verify a current source-bound TEST admission at confirm.')
    expect(preview.counts.localFileRestore.mountRequiredBusinessIds).toContain(scope.businessId)
    expect(preview.confirmationBinding).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await db.auditEvent.count({ where: { entityType: 'OPERATOR_ACTION', entityId: 'local',
      action: 'BACKUP_PREVIEW', actorId: person.id } })).toBe(2)
    const localMountRoot = path.join(root, 'target-local-files')
    await mkdir(path.join(localMountRoot, 'test-only'), { recursive: true })
    await writeFile(path.join(localMountRoot, 'test-only', 'postpass-failure.bin'), Buffer.from('target local test content'))
    const transferRemounts = [{ businessId: scope.businessId, deviceKey: 'fr293-test-device', rootPath: localMountRoot }]
    await browserRun.page.getByLabel('Target-local remount JSON').fill(JSON.stringify(transferRemounts))
    const confirmation = { confirmationBinding: preview.confirmationBinding, expectedJobVersion: preview.jobVersion }
    const closedEnv = { ...runtimeEnv, ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE: undefined,
      ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_PUBLIC_KEY_FILE: undefined }
    const refused = await createManagedBlobBackupTransferHttpHandler({ db, env: closedEnv, storageFactory: provider.factory })
      (post(`/${preview.jobId}/confirm`, JSON.stringify(confirmation)), { action: 'confirm', jobId: preview.jobId })
    expect(refused.status).toBe(503)
    const refusedBody = await refused.json()
    expect(refusedBody).toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED', retryable: false })
    expect(provider.putCount).toBe(0)
    expect((await db.managedBlobBackupTransferJob.findUnique({ where: { id: preview.jobId } })).state).toBe('PREVIEWED')

    const sourceFile = fileURLToPath(new URL('../../src/modules/project-manager/application/managed-blob-transfer-service.js', import.meta.url))
    const testFile = fileURLToPath(import.meta.url)
    const signerFile = fileURLToPath(new URL('../helpers/managed-blob-transfer-test-signer.mjs', import.meta.url))
    const sourceEvidenceSha256 = sha(Buffer.concat([await readFile(sourceFile), await readFile(testFile), await readFile(signerFile)]))
    const previewJob = await db.managedBlobBackupTransferJob.findUnique({ where: { id: preview.jobId } })
    const targetIdentity = (await db.$queryRawUnsafe(`SELECT current_database() AS "databaseName",
      host(inet_server_addr()) AS "serverAddress",
      current_setting('data_directory') AS "directory",
      (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid"`))[0]
    const targetFingerprintSha256 = managedBlobTransferTestTargetFingerprint(targetIdentity)
    expect(managedBlobTransferConfigHash(runtimeEnv)).toBe(previewJob.targetConfigHash)
    const claims = { schemaVersion: MANAGED_BLOB_TRANSFER_TEST_ADMISSION_CLAIMS, environment: 'TEST',
      databaseName: targetIdentity.databaseName, databaseOid: targetIdentity.databaseOid,
      transferJobId: preview.jobId, targetId: `embedded-postgres:${targetFingerprintSha256.slice(0, 16)}`,
      targetFingerprintSha256, targetGeneration: previewJob.generation,
      syntheticDatasetSha256: sha(canonicalJSON({ tenantId: scope.tenantId, businessId: scope.businessId,
        assetId: sourceRows.assetId, aliasId: sourceRows.aliasId, sha256: digest })),
      sourceRevision: previewJob.sourceRevision, targetConfigSha256: previewJob.targetConfigHash,
      sourceEvidenceSha256, packageSha256: previewJob.packageSha256, maintenanceMode: true, quiesced: true,
      admissionId: randomUUID(), issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }
    const signerPid = await signTestAdmissionInHarness(claims,
      runtimeEnv.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE,
      runtimeEnv.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_PUBLIC_KEY_FILE)
    expect(signerPid).toBeGreaterThan(0)
    expect(existsSync(path.join(root, 'harness-signing-private.pem'))).toBe(false)
    const testAdmission = createManagedBlobTransferTestAdmissionFromEnvironment(runtimeEnv)
    expect(testAdmission).toBeTruthy()
    const claimAdmission = await testAdmission.authorize({ databaseName: targetIdentity.databaseName,
      databaseOid: targetIdentity.databaseOid, transferJobId: preview.jobId,
      targetId: claims.targetId, targetFingerprintSha256, targetGeneration: previewJob.generation,
      targetConfigHash: previewJob.targetConfigHash, sourceRevision: previewJob.sourceRevision,
      packageSha256: previewJob.packageSha256 })
    const admitted = handler
    // Exercise the real durable claim after preview and byte deadlines expire.
    // The first resumed worker loses its response after a provider write; a
    // later page reload must reconcile that exact write after the claim window
    // expires, then start a fresh bounded restore worker.
    const token = request.headers.get('cookie').split('=', 2)[1]
    const verifiedSession = verifySessionToken(token, { secret: runtimeEnv.ZURI_SESSION_SECRET })
    const grant = await db.platformGrant.findFirst({ where: { personId: person.id, capability: 'OPERATOR', status: 'ACTIVE' } })
    const operatorProof = { actorId: person.id, sessionId: verifiedSession.sessionId,
      tokenHash: hashSessionToken(token), tokenExpiresAt: verifiedSession.expiresAt * 1000, grantId: grant.id }
    const durableClaim = await beginManagedBlobTransferRestore(db, { jobId: preview.jobId, actorId: person.id,
      expectedJobVersion: previewJob.version, expectedGeneration: previewJob.generation, operatorProof,
      admission: claimAdmission, restoreRemountsJson: JSON.stringify(transferRemounts) })
    const interruptedAttempt = durableClaim.restoreAttemptId, expiredRestore = new Date(Date.now() - 1)
    await db.$transaction(async tx => {
      await tx.managedBlobBackupTransferJob.update({ where: { id: preview.jobId }, data: {
        workerId: 'interrupted-worker',
        restoreClaimedAt: new Date(Date.now() - MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs - 1_000),
        expiresAt: expiredRestore, byteDeadline: expiredRestore,
        epoch: { increment: 1 }, leaseExpiresAt: new Date(Date.now() - 1),
        version: { increment: 1 },
      } })
    })
    const claimedJob = await db.managedBlobBackupTransferJob.findUnique({ where: { id: preview.jobId } })
    expect(await db.managedBlobBackupTransferEntry.findMany({ where: { jobId: preview.jobId } }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ state: 'PENDING', attempts: 0 })]))
    const recoveredConfirmation = { ...confirmation, expectedJobVersion: claimedJob.version }
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fr293_test_fail_postpass() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD."name" = 'postpass-failure.bin' AND NEW."status" = 'ACTIVE' THEN
        RAISE EXCEPTION 'injected disposable postpass failure'; END IF; RETURN NEW; END $$`)
    await db.$executeRawUnsafe(`CREATE TRIGGER fr293_test_fail_postpass BEFORE UPDATE ON "FileAsset"
      FOR EACH ROW EXECUTE FUNCTION fr293_test_fail_postpass()`)
    await browserRun.page.getByRole('button', { name: 'Status' }).click({ timeout: 5_000 })
    loseFirstRestorePutResponse = true
    const firstConfirmResponse = browserRun.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/confirm'), { timeout: 5_000 }).catch(() => null)
    await browserRun.page.getByRole('button', { name: /(?:Confirm|Resume) TEST restore/ }).click({ timeout: 5_000 })
    const firstResponse = await firstConfirmResponse
    if (!firstResponse) throw new Error(`UI confirm did not receive a response: ${JSON.stringify({
      requests: browserRun.requests, pageErrors: browserRun.pageErrors, consoleErrors: browserRun.consoleErrors,
      text: await browserRun.page.locator('body').innerText(),
    })}`)
    expect(firstResponse.status()).toBe(202)
    await waitForTransferJob(admitted, request.headers.get('cookie'), preview.jobId, 'UNKNOWN')
    const interruptedEntry = await db.managedBlobBackupTransferEntry.findFirst({ where: { jobId: preview.jobId } })
    expect(interruptedEntry).toMatchObject({ state: 'WRITING', attempts: 1, targetRef: null, unresolved: true })
    await db.managedBlobBackupTransferJob.update({ where: { id: preview.jobId }, data: {
      restoreClaimedAt: new Date(Date.now() - MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs - 1_000),
      version: { increment: 1 },
    } })
    await browserRun.page.reload({ waitUntil: 'domcontentloaded' })
    await browserRun.page.getByText('Kind / state: RESTORE / UNKNOWN', { exact: false }).waitFor({ timeout: 5_000 })
    await browserRun.page.getByRole('button', { name: 'Resume TEST restore' }).waitFor({ timeout: 5_000 })
    const recoveredConfirmResponse = browserRun.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/confirm'), { timeout: 5_000 }).catch(() => null)
    await browserRun.page.getByRole('button', { name: 'Resume TEST restore' }).click({ timeout: 5_000 })
    const recoveredResponse = await recoveredConfirmResponse
    if (!recoveredResponse) throw new Error(`UI could not resume an expired ambiguous restore: ${JSON.stringify({
      requests: browserRun.requests, pageErrors: browserRun.pageErrors, consoleErrors: browserRun.consoleErrors,
      text: await browserRun.page.locator('body').innerText(),
    })}`)
    expect(recoveredResponse.status()).toBe(202)
    await waitForTransferJob(admitted, request.headers.get('cookie'), preview.jobId, 'METADATA_COMMITTED')
    const committedJob = await db.managedBlobBackupTransferJob.findUnique({ where: { id: preview.jobId } })
    expect(committedJob).toMatchObject({ state: 'METADATA_COMMITTED', unresolved: true, workerId: null,
      leaseExpiresAt: null, restoreRemountsJson: JSON.stringify(transferRemounts) })
    expect(committedJob.restoreClaimedAt.getTime())
      .toBeGreaterThan(Date.now() - MANAGED_BLOB_TRANSFER_PROFILE.jobDurationMs)
    await expect(db.$transaction(tx => redactManagedBlobTransferActor(tx, person.id)))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_ERASURE_CUSTODY_OPEN' })
    expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: preview.jobId } }))
      .toMatchObject({ state: 'METADATA_COMMITTED', actorId: person.id, unresolved: true })
    await browserRun.page.reload({ waitUntil: 'domcontentloaded' })
    await browserRun.page.getByText('Kind / state: RESTORE / METADATA_COMMITTED', { exact: false }).waitFor({ timeout: 5_000 })
    await browserRun.page.getByRole('button', { name: 'Resume TEST restore' }).waitFor({ timeout: 5_000 })
    expect(await db.managedBlobRecoveryInstallationFence.findUnique({ where: { id: 'installation' } }))
      .toMatchObject({ mode: 'RESTORING', generation: 2, restoreAttemptId: interruptedAttempt })
    const committedAuditCount = await db.auditEvent.count({ where: { entityType: 'SNAPSHOT', entityId: preview.jobId,
      action: 'TRANSFER_METADATA_COMMITTED' } })
    expect(committedAuditCount).toBe(1)
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fr293_test_fail_postpass ON "FileAsset"')
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS fr293_test_fail_postpass()')
    const resumeConfirmResponse = browserRun.page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/confirm'), { timeout: 5_000 }).catch(() => null)
    await browserRun.page.getByRole('button', { name: 'Resume TEST restore' }).click({ timeout: 5_000 })
    const resumeResponse = await resumeConfirmResponse
    if (!resumeResponse) throw new Error(`UI resume did not receive a response: ${JSON.stringify({
      requests: browserRun.requests, pageErrors: browserRun.pageErrors, consoleErrors: browserRun.consoleErrors,
      text: await browserRun.page.locator('body').innerText(),
    })}`)
    expect(resumeResponse.status()).toBe(202)
    const restored = await waitForTransferJob(admitted, request.headers.get('cookie'), preview.jobId, 'NEEDS_ADMISSION')
    expect(restored).toMatchObject({ state: 'NEEDS_ADMISSION', outcome: 'RESTORED_NEEDS_ADMISSION' })
    await browserRun.page.getByRole('button', { name: 'Status' }).click({ timeout: 5_000 })
    await browserRun.page.getByText('Kind / state: RESTORE / NEEDS_ADMISSION', { exact: false }).waitFor({ timeout: 5_000 })
    await browserRun.page.getByText('Restore completed on the admitted TEST target. This generation remains NEEDS_ADMISSION; ordinary recovery is still unavailable.', { exact: true }).waitFor({ timeout: 5_000 })
    expect(provider.putCount).toBe(1)
    expect(await provider.hasRef({ purpose: 'asset', ref: sourceRef, scope, expectedSha256: digest,
      expectedByteLength: bytes.length })).toBe(false)
    const [assetAfter, aliasAfter, sentinelAfter, fence, durableJob, durableEntries] = await Promise.all([
      db.fileAsset.findUnique({ where: { id: sourceRows.assetId } }),
      db.projectFile.findUnique({ where: { id: sourceRows.aliasId } }),
      db.fileAsset.findUnique({ where: { id: sentinel.id } }),
      db.managedBlobRecoveryInstallationFence.findUnique({ where: { id: 'installation' } }),
      db.managedBlobBackupTransferJob.findUnique({ where: { id: preview.jobId } }),
      db.managedBlobBackupTransferEntry.findMany({ where: { jobId: preview.jobId } }),
    ])
    expect(assetAfter.blobRef).not.toBe(sourceRef)
    expect(assetAfter).toMatchObject({ sha256: digest, size: bytes.length, version: 1 })
    expect(await db.fileAsset.findUnique({ where: { id: sourceRows.localAssetId } })).toMatchObject({ status: 'ACTIVE' })
    expect(aliasAfter).toMatchObject({ blobRef: assetAfter.blobRef, size: bytes.length })
    expect(sentinelAfter).toBeNull()
    expect(fence).toMatchObject({ mode: 'NEEDS_ADMISSION', generation: 2, restoreAttemptId: expect.any(String) })
    expect(durableJob.admissionJson).toContain(sourceEvidenceSha256)
    expect(durableJob.admissionJson).toContain('zuri_server_test')
    expect(durableJob.admissionId).toBe(claimAdmission.admissionId)
    expect(await db.managedBlobBackupTransferJob.findUnique({ where: { admissionId: claimAdmission.admissionId } }))
      .toMatchObject({ id: preview.jobId, state: 'NEEDS_ADMISSION' })
    await expect(db.managedBlobBackupTransferJob.create({ data: { id: randomUUID(), kind: 'EXPORT', state: 'COMPLETE',
      generation: 2, targetConfigHash: '9'.repeat(64), admissionId: claimAdmission.admissionId,
      expiresAt: new Date(Date.now() + 60_000), byteDeadline: new Date(Date.now() + 60_000) } }))
      .rejects.toMatchObject({ code: 'P2002' })
    expect(durableEntries).toHaveLength(1)
    expect(durableEntries[0]).toMatchObject({ state: 'VERIFIED', unresolved: false, targetRef: assetAfter.blobRef,
      targetKey: expect.stringContaining('/recovery/') })
    await expect(provider.readExact({ purpose: 'asset', ref: assetAfter.blobRef, scope,
      expectedSha256: digest, expectedByteLength: bytes.length })).resolves.toEqual(bytes)
    expect(await db.auditEvent.count({ where: { entityType: 'SNAPSHOT', entityId: preview.jobId,
      action: 'TRANSFER_METADATA_COMMITTED' } })).toBe(committedAuditCount)
    expect(await db.auditEvent.count({ where: { entityType: 'SNAPSHOT', entityId: preview.jobId,
      action: 'TRANSFER_RESTORED_NEEDS_ADMISSION' } })).toBe(1)
    expect(await db.auditEvent.count({ where: { entityType: 'OPERATOR_ACTION', entityId: 'local',
      action: 'TRANSFER_RESTORE_CONFIRM', actorId: person.id } })).toBe(1)
    expect(restoreAuditPresentAtProviderWrite).toBe(true)
    expect(durableJob.restoreRemountsJson).toBeNull()
    const repeated = await admitted(post(`/${preview.jobId}/confirm`, JSON.stringify(confirmation)),
      { action: 'confirm', jobId: preview.jobId })
    expect(repeated.status).toBe(202)
    expect((await repeated.json()).job).toMatchObject({ state: 'NEEDS_ADMISSION' })
    expect(provider.putCount).toBe(1)
    expect(MANAGED_BLOB_TRANSFER_PROFILE.maxPackageBytes).toBeLessThanOrEqual(MANAGED_BLOB_TRANSFER_PROFILE.spoolQuotaBytes)

    const maintenanceSpool = createManagedBlobTransferSpool(root), expiredAt = new Date(Date.now() - 60_000)
    const expiredPackageId = randomUUID(), expiredPackage = Buffer.from('expired sealed export')
    const expiredPackageReceipt = await maintenanceSpool.write(expiredPackageId, [expiredPackage],
      { maxBytes: 1024, deadline: Date.now() + 5000 })
    await db.managedBlobBackupTransferJob.create({ data: { id: expiredPackageId, actorId: person.id,
      kind: 'EXPORT', state: 'COMPLETE', generation: 2, targetConfigHash: 'e'.repeat(64), spoolId: expiredPackageId,
      spoolSha256: expiredPackageReceipt.sha256, packageSha256: expiredPackageReceipt.sha256,
      spoolBytes: expiredPackage.length, spoolReservedBytes: expiredPackage.length, expiresAt: expiredAt,
      byteDeadline: expiredAt, unresolved: false } })
    const expiredPreviewId = randomUUID(), expiredPreview = Buffer.from('expired unconfirmed preview')
    const expiredPreviewReceipt = await maintenanceSpool.write(expiredPreviewId, [expiredPreview],
      { maxBytes: 1024, deadline: Date.now() + 5000 })
    await db.managedBlobBackupTransferJob.create({ data: { id: expiredPreviewId, actorId: person.id,
      kind: 'RESTORE', state: 'PREVIEWED', generation: 2, targetConfigHash: 'f'.repeat(64),
      spoolId: expiredPreviewId, spoolSha256: expiredPreviewReceipt.sha256,
      packageSha256: expiredPreviewReceipt.sha256, spoolBytes: expiredPreview.length,
      spoolReservedBytes: expiredPreview.length, confirmationDigest: 'a'.repeat(64), expiresAt: expiredAt,
      byteDeadline: new Date(Date.now() + 60_000), unresolved: true } })
    await db.managedBlobBackupTransferEntry.create({ data: { id: randomUUID(), jobId: expiredPreviewId,
      objectId: 'object-expired', purpose: 'asset', sha256: digest, byteLength: bytes.length,
      bindingsJson: '[]', state: 'PENDING', unresolved: true } })
    const unresolvedPayloadId = randomUUID(), unresolvedPayload = Buffer.from('must remain quarantined')
    const unresolvedReceipt = await maintenanceSpool.write(unresolvedPayloadId, [unresolvedPayload],
      { maxBytes: 1024, deadline: Date.now() + 5000 })
    await db.managedBlobBackupTransferJob.create({ data: { id: unresolvedPayloadId, actorId: null,
      kind: 'RESTORE', state: 'UNKNOWN', generation: 2, targetConfigHash: '1'.repeat(64),
      spoolId: unresolvedPayloadId, spoolSha256: unresolvedReceipt.sha256, packageSha256: unresolvedReceipt.sha256,
      spoolBytes: unresolvedPayload.length, spoolReservedBytes: unresolvedPayload.length, expiresAt: expiredAt,
      byteDeadline: expiredAt, attempts: 1, unresolved: true } })
    const maintenance = await maintainManagedBlobTransferCustody({ db, dataDirectory: root })
    expect(maintenance).toMatchObject({ examined: 2, payloadsRemoved: 2, retainedForReconciliation: 0 })
    expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: expiredPackageId } }))
      .toMatchObject({ state: 'COMPLETE', spoolId: null, spoolReservedBytes: 0 })
    expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: expiredPreviewId } }))
      .toMatchObject({ state: 'ABANDONED', unresolved: false, spoolId: null, confirmationDigest: null })
    expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: unresolvedPayloadId } }))
      .toMatchObject({ state: 'UNKNOWN', unresolved: true, spoolId: unresolvedPayloadId })
    expect(await maintenanceSpool.read(unresolvedPayloadId, { byteLength: unresolvedPayload.length,
      sha256: unresolvedReceipt.sha256, maxBytes: 1024 })).toEqual(unresolvedPayload)
    await maintenanceSpool.remove(unresolvedPayloadId)
    await db.managedBlobBackupTransferJob.delete({ where: { id: unresolvedPayloadId } })

    const ambiguousId = randomUUID()
    await db.managedBlobBackupTransferJob.create({ data: { id: ambiguousId, actorId: person.id, kind: 'RESTORE',
      state: 'UNKNOWN', generation: 2, targetConfigHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 60_000),
      byteDeadline: new Date(Date.now() + 60_000), attempts: 1, unresolved: true } })
    await expect(db.$transaction(tx => redactManagedBlobTransferActor(tx, person.id)))
      .rejects.toMatchObject({ status: 409, code: 'MANAGED_BLOB_TRANSFER_ERASURE_CUSTODY_OPEN' })
    await db.managedBlobBackupTransferJob.delete({ where: { id: ambiguousId } })

    const cleanupId = randomUUID(), payload = Buffer.from('synthetic private package')
    const cleanupSpool = createManagedBlobTransferSpool(root)
    const spoolReceipt = await cleanupSpool.write(cleanupId, [payload], { maxBytes: 1024, deadline: Date.now() + 5000 })
    await db.managedBlobBackupTransferJob.create({ data: { id: cleanupId, actorId: person.id, kind: 'EXPORT',
      state: 'COMPLETE', generation: 2, targetConfigHash: 'd'.repeat(64), spoolId: cleanupId,
      spoolSha256: spoolReceipt.sha256, packageSha256: spoolReceipt.sha256, spoolBytes: payload.length,
      spoolReservedBytes: payload.length, expiresAt: new Date(Date.now() + 60_000),
      byteDeadline: new Date(Date.now() + 60_000), unresolved: false } })
    const erasure = await db.$transaction(tx => redactManagedBlobTransferActor(tx, person.id))
    expect(erasure).toMatchObject({ redactedJobs: 8, cleanupJobIds: [cleanupId] })
    expect(await completeManagedBlobTransferErasureCleanup(db, { jobId: cleanupId, dataDirectory: root })).toBe(true)
    expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: cleanupId } })).toMatchObject({
      actorId: null, state: 'ABANDONED', spoolId: null, unresolved: false,
    })
    expect(await db.managedBlobBackupTransferJob.findUnique({ where: { id: preview.jobId } })).toMatchObject({
      actorId: null, state: 'NEEDS_ADMISSION', unresolved: false,
    })
  })
})
