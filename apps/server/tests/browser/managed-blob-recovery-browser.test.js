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
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'

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
it('exercises the real recovery component and HTTP handlers in a browser, with fixture-only provisioning', async () => {
  // Controlled application transport evidence, not supported provisioning,
  // installed acceptance, real provider or FR-293 round-trip qualification.
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ManagedBlobRecovery} from './src/modules/project-manager/components/ManagedBlobRecovery.jsx';
    createRoot(document.getElementById('root')).render(React.createElement(ManagedBlobRecovery,{file:window.testFile}));`,
    resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' } })
  let browserHandler, browserEnv
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = browserEnv.PUBLIC_BASE_URL + incoming.url
      if (incoming.url === '/') {
        outgoing.setHeader('content-type', 'text/html')
        outgoing.end(`<div id="root"></div><script>window.testFile=${JSON.stringify({ id: file.id, version: 1 })}</script><script>${bundle.outputFiles[0].text}</script>`)
        return
      }
      const controller = new AbortController()
      incoming.on('aborted', () => controller.abort())
      const req = new Request(url, { method: incoming.method, headers: incoming.headers, signal: controller.signal,
        ...(incoming.method === 'GET' ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }) })
      let response
      if (incoming.url === '/api/auth/csrf') {
        const session = await createSessionPort({ db, env: browserEnv }).read(req)
        response = Response.json(issueApiWriteCsrfToken({ request: req, session, env: browserEnv }))
      } else {
        const parts = new URL(url).pathname.split('/')
        response = await browserHandler(req, { fileId: parts[3], operationId: parts[5], action: parts[6] || (incoming.method === 'GET' ? 'status' : 'prepare') })
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.writeHead(500); outgoing.end('TEST server error') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  browserEnv = { ...env, PUBLIC_BASE_URL: origin }
  browserHandler = createRecoveryHttpHandler({ db, env: browserEnv, service })
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    await context.addCookies([{ name: 'zuri_session', value: cookie.split('=')[1], url: origin }])
    const page = await context.newPage()
    let dropPreview = true
    await page.route('**/preview', async route => {
      if (!dropPreview) return route.continue()
      dropPreview = false
      // Let the real handler durably finish, then drop only browser delivery.
      // Socket resets can be transparently replayed by Chromium and therefore
      // do not reliably model a lost application response.
      await route.fetch()
      await route.abort('failed')
    })
    await page.goto(origin)
    await page.getByRole('button', { name: 'Recover original', exact: true }).click()
    await page.getByRole('button', { name: 'Prepare recovery', exact: true }).click()
    await page.getByLabel('Exact original file', { exact: true }).setInputFiles({ name: 'original.pdf', mimeType: 'application/pdf', buffer: content })
    await page.getByRole('button', { name: 'Preview original', exact: true }).click()
    await page.getByRole('alert').waitFor({ timeout: 1500 })
    expect(await page.getByRole('button', { name: 'Preview original', exact: true }).isDisabled()).toBe(true)
    await page.getByRole('button', { name: 'Check operation status', exact: true }).click()
    await page.getByRole('button', { name: 'Recover preview binding', exact: true }).waitFor({ timeout: 1500 })
    await page.getByRole('button', { name: 'Recover preview binding', exact: true }).click()
    await page.getByRole('button', { name: 'Stage verified original', exact: true }).waitFor()
    expect(puts).toBe(0)
    await page.getByRole('button', { name: 'Stage verified original', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm recovery of this file', exact: true }).waitFor()
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(1)
    await page.getByRole('button', { name: 'Confirm recovery of this file', exact: true }).click()
    await page.getByText('Metadata committed and exact bytes verified at confirmation.', { exact: true }).waitFor()
    expect(puts).toBe(1)
    await page.getByRole('button', { name: 'Check operation status', exact: true }).click()
    await page.getByText('Metadata committed. Current byte availability is not verified by this status read.', { exact: true }).waitFor()
    expect((await db.fileAsset.findUnique({ where: { id: file.id } })).version).toBe(2)
    browserHandler = createRecoveryHttpHandler({ db, env: browserEnv })
    await page.reload()
    await page.getByRole('button', { name: 'Recover original', exact: true }).click()
    await page.getByRole('button', { name: 'Prepare recovery', exact: true }).click()
    const refusal = page.getByRole('alert')
    await refusal.waitFor()
    expect(await refusal.textContent()).toContain('pending backup transfer qualification')
    expect(await refusal.textContent()).not.toMatch(/lost response|blindly|Check status/)
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
})
