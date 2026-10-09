// @spec ADR-107 - HTTP contract, streaming and retry proof.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createFileService } from '../src/file-service.js'
import { createFileHttpServer } from '../src/http-server.js'
import { businessA, businessB, makeAuthority, MemoryRepository, MemoryStorage, sha256, tenantId } from './fakes.js'

async function runningServer(t, { uploadTimeoutMs = 600000, extraPermissions = [], maxConcurrentUploads = 1 } = {}) {
  const repository = new MemoryRepository()
  const storage = new MemoryStorage()
  const authority = makeAuthority({ extraPermissions })
  const service = createFileService({ repository, storage, authority })
  const server = createFileHttpServer({ service, uploadTimeoutMs, maxConcurrentUploads })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(resolve))
    server.closeAllConnections()
    await closed
  })
  return { repository, storage, authority, server, base: `http://127.0.0.1:${server.address().port}` }
}

function uploadHeaders(body, businessId, idempotencyKey, provenance = { kind: 'BROWSER_UPLOAD', sourceId: 'http-test' }) {
  if (!uploadHeaders.identities) uploadHeaders.identities = new Map()
  if (!uploadHeaders.identities.has(idempotencyKey)) uploadHeaders.identities.set(idempotencyKey, { operationId: randomUUID(), correlationId: randomUUID() })
  const { operationId, correlationId } = uploadHeaders.identities.get(idempotencyKey)
  return {
    authorization: 'Bearer test-user-token',
    'x-tenant-id': tenantId,
    'x-business-id': businessId,
    'idempotency-key': idempotencyKey,
    'x-operation-id': operationId,
    'x-correlation-id': correlationId,
    'x-deadline': new Date(Date.now() + 60000).toISOString(),
    'content-type': 'text/csv',
    'x-content-length': String(body.length),
    'x-content-sha256': sha256(body),
    'x-file-name': encodeURIComponent('catalog.csv'),
    'x-file-provenance': Buffer.from(JSON.stringify(provenance)).toString('base64url'),
  }
}

test('FilePort HTTP upload and exact-version download preserve the original bytes', async (t) => {
  const { base, storage } = await runningServer(t)
  const bytes = Buffer.from('sku,price\nSKU-1,10\n')
  const requestHeaders = uploadHeaders(bytes, businessB, `http-${randomUUID()}`)
  const created = await fetch(`${base}/v1/files`, { method: 'POST', headers: requestHeaders, body: bytes })
  assert.equal(created.status, 201)
  const receipt = await created.json()
  assert.equal(receipt.status, 'STORED')
  assert.equal(receipt.operationId, requestHeaders['x-operation-id'])
  assert.equal(receipt.correlationId, requestHeaders['x-correlation-id'])
  assert.equal(storage.objects.size, 1)
  const metadata = await fetch(`${base}/v1/files/${receipt.fileId}`, { headers: { authorization: 'Bearer test-user-token', 'x-tenant-id': tenantId, 'x-business-id': businessB } })
  const file = await metadata.json()
  assert.equal(metadata.status, 200)
  assert.equal('storageKey' in file.currentVersion, false)
  assert.equal('storageProvider' in file.currentVersion, false)
  assert.equal('storageBindingId' in file.currentVersion, false)
  assert.equal('storageBucket' in file.currentVersion, false)
  const content = await fetch(`${base}/v1/files/${receipt.fileId}/versions/${receipt.versionId}/content`, {
    headers: { authorization: 'Bearer test-user-token', 'x-tenant-id': tenantId, 'x-business-id': businessB },
  })
  assert.equal(content.status, 200)
  assert.equal(content.headers.get('x-content-sha256'), sha256(bytes))
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes)
})

test('accepts synthetic LINE capture through FilePort with source-specific authority', async (t) => {
  const { base, authority, repository, storage } = await runningServer(t, { extraPermissions: ['files:line-capture'] })
  const body = Buffer.from('synthetic LINE attachment bytes')
  const provenance = { kind: 'LINE_CAPTURE', sourceId: 'capture-fixture-1', channelBindingId: 'channel-fixture-1', providerMessageId: 'message-fixture-1', attachmentOrdinal: 0, contentProviderType: 'line' }
  const headers = uploadHeaders(body, businessB, 'http-' + randomUUID(), provenance)
  const created = await fetch(base + '/v1/files', { method: 'POST', headers, body })
  assert.equal(created.status, 201)
  const receipt = await created.json()
  assert.deepEqual(authority.calls[0].provenance, provenance)
  assert.deepEqual(repository.versions.get(receipt.fileId)[0].provenance, provenance)
  assert.equal(storage.objects.size, 1)
})

test('denied Business upload produces no object side effect', async (t) => {
  const { base, storage } = await runningServer(t)
  const body = Buffer.from('should not persist')
  const denied = await fetch(`${base}/v1/files`, { method: 'POST', headers: uploadHeaders(body, businessA, `http-${randomUUID()}`), body })
  assert.equal(denied.status, 403)
  assert.equal(storage.objects.size, 0)
})

test('file list pagination and search stay within the authorized Business', async (t) => {
  const { base } = await runningServer(t)
  const firstBytes = Buffer.from('first bytes')
  const secondBytes = Buffer.from('second bytes')
  const first = await fetch(`${base}/v1/files`, { method: 'POST', headers: uploadHeaders(firstBytes, businessB, `http-${randomUUID()}`), body: firstBytes })
  const second = await fetch(`${base}/v1/files`, { method: 'POST', headers: uploadHeaders(secondBytes, businessB, `http-${randomUUID()}`), body: secondBytes })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)

  const headers = { authorization: 'Bearer test-user-token', 'x-tenant-id': tenantId, 'x-business-id': businessB }
  const pageOneResponse = await fetch(`${base}/v1/files?limit=1&q=catalog`, { headers })
  const pageOne = await pageOneResponse.json()
  assert.equal(pageOneResponse.status, 200)
  assert.equal(pageOne.files.length, 1)
  assert.equal(typeof pageOne.nextCursor, 'string')
  assert.equal(pageOne.files[0].businessId, businessB)

  const pageTwoResponse = await fetch(`${base}/v1/files?limit=1&q=catalog&cursor=${encodeURIComponent(pageOne.nextCursor)}`, { headers })
  const pageTwo = await pageTwoResponse.json()
  assert.equal(pageTwoResponse.status, 200)
  assert.equal(pageTwo.files.length, 1)
  assert.equal(pageTwo.nextCursor, null)
  assert.notEqual(pageOne.files[0].id, pageTwo.files[0].id)

  const denied = await fetch(`${base}/v1/files`, { headers: { ...headers, 'x-business-id': businessA } })
  assert.equal(denied.status, 403)
})

test('upload rejects byte-size and digest mismatches before storage', async (t) => {
  const { base, storage } = await runningServer(t)
  const body = Buffer.from('declared incorrectly')
  const headers = uploadHeaders(body, businessB, `http-${randomUUID()}`)
  headers['x-content-sha256'] = '0'.repeat(64)
  const response = await fetch(`${base}/v1/files`, { method: 'POST', headers, body })
  assert.equal(response.status, 409)
  assert.equal(storage.objects.size, 0)
})

test('stalled upload body is aborted within the configured deadline', async (t) => {
  const { base, storage } = await runningServer(t, { uploadTimeoutMs: 40 })
  const body = Buffer.from('stalled')
  const startedAt = Date.now()
  const outcome = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/v1/files`, {
      method: 'POST',
      headers: { ...uploadHeaders(body, businessB, `http-${randomUUID()}`), 'content-length': String(body.length) },
    }, (response) => {
      response.resume()
      response.on('end', () => resolve({ status: response.statusCode, elapsedMs: Date.now() - startedAt }))
    })
    const watchdog = setTimeout(() => {
      request.destroy()
      reject(new Error('stalled upload exceeded the test watchdog'))
    }, 1000)
    request.on('error', (error) => {
      clearTimeout(watchdog)
      resolve({ error, elapsedMs: Date.now() - startedAt })
    })
    request.write(body.subarray(0, 1))
  })

  assert.ok(outcome.elapsedMs < 900)
  assert.ok(outcome.error || outcome.status === 408)
  assert.equal(storage.objects.size, 0)
})

test('persists the operation intent before streaming and retries the same upload safely', async (t) => {
  const { base, repository, storage } = await runningServer(t, { maxConcurrentUploads: 2 })
  const body = Buffer.from('durable operation before upload stream')
  const headers = { ...uploadHeaders(body, businessB, 'http-' + randomUUID()), 'content-length': String(body.length) }
  const partial = httpRequest(base + '/v1/files', { method: 'POST', headers }, (response) => response.resume())
  partial.on('error', () => {})
  partial.write(body.subarray(0, 1))

  const deadline = Date.now() + 1000
  while (repository.operations.size === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(repository.operations.size, 1)
  const [pending] = repository.operations.values()
  assert.equal(pending.status, 'PENDING')
  assert.equal(storage.putCount, 0)

  partial.destroy()
  const retried = await fetch(base + '/v1/files', { method: 'POST', headers, body })
  assert.equal(retried.status, 201)
  const receipt = await retried.json()
  assert.equal(receipt.operationId, pending.operationId)
  assert.equal(repository.operations.size, 1)
  assert.equal(repository.operations.get(pending.operationId).status, 'COMMITTED')
  assert.equal(storage.putCount, 1)
  assert.equal(storage.objects.size, 1)
})
