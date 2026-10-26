// @req FR-109, FR-173 — exact object versions, private requests and readback
// hashes are required for the raw artifact storage boundary.
// @spec TASK-ZAI-049 storage spec
// @tested src/platform/storage/s3-object-storage.js
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createS3ObjectStoragePort, createConfiguredKnowledgeObjectStoragePort } from '@/platform/storage/s3-object-storage'

const CONTENT = Buffer.from([0, 1, 2, 255, 10])

describe('TASK-ZAI-049 S3-compatible storage port', () => {
  it('writes immutable content, signs a private request, and returns the provider version', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { 'x-amz-version-id': 'v-1' } }))
    const port = createS3ObjectStoragePort({ endpoint: 'http://minio.internal:9000', accessKeyId: 'access', secretAccessKey: 'secret', bucket: 'knowledge-raw', fetchFn, now: () => new Date('2026-09-17T10:00:00.000Z') })
    const result = await port.putImmutable({ key: 'knowledge/raw/tenant/business/raw-1/hash', content: CONTENT, contentType: 'text/plain' })
    expect(result).toMatchObject({ key: 'knowledge/raw/tenant/business/raw-1/hash', versionId: 'v-1', byteLength: CONTENT.length })
    const [url, request] = fetchFn.mock.calls[0]
    expect(url).toBe('http://minio.internal:9000/knowledge-raw/knowledge/raw/tenant/business/raw-1/hash')
    expect(request.method).toBe('PUT')
    expect(request.headers).toMatchObject({ 'if-none-match': '*', 'content-type': 'text/plain', 'x-amz-content-sha256': expect.stringMatching(/^[a-f0-9]{64}$/), Authorization: expect.stringContaining('Credential=access/') })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('reads and erases only exact object versions', async () => {
    const read = vi.fn().mockResolvedValue(new Response(CONTENT, { status: 200, headers: { 'content-type': 'application/octet-stream' } }))
    const erase = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const port = createS3ObjectStoragePort({ endpoint: 'http://minio.internal:9000', accessKeyId: 'access', secretAccessKey: 'secret', bucket: 'knowledge-raw', fetchFn: vi.fn().mockImplementation((url, request) => request.method === 'GET' ? read(url, request) : erase(url, request)) })
    await expect(port.readExact({ key: 'raw-1', versionId: 'v-1' })).resolves.toMatchObject({ bytes: CONTENT, versionId: 'v-1', byteLength: CONTENT.length })
    await expect(port.eraseExactVersions({ key: 'raw-1', versionIds: ['v-1'] })).resolves.toEqual({ key: 'raw-1', erasedVersionIds: ['v-1'] })
    expect(read.mock.calls[0][0]).toContain('versionId=v-1')
    expect(erase.mock.calls[0][0]).toContain('versionId=v-1')
    await expect(port.eraseExactVersions({ key: 'raw-1' })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_VERSION_REQUIRED' })
  })

  it('checks the provider version on exact reads and exposes stat metadata', async () => {
    const requests = []
    const fetchFn = vi.fn().mockImplementation(async (url, request) => {
      requests.push([url, request])
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { 'x-amz-version-id': 'v-1', 'x-amz-meta-sha256': 'a'.repeat(64), 'content-length': String(CONTENT.length), 'content-type': 'application/octet-stream' } })
      return new Response(CONTENT, { status: 200, headers: { 'x-amz-version-id': 'v-1', 'content-type': 'application/octet-stream' } })
    })
    const port = createS3ObjectStoragePort({ endpoint: 'http://minio.internal:9000', accessKeyId: 'access', secretAccessKey: 'secret', bucket: 'knowledge-raw', fetchFn })
    await expect(port.readExact({ key: 'raw-1', versionId: 'v-1' })).resolves.toMatchObject({ versionId: 'v-1', bytes: CONTENT })
    await expect(port.statExact({ key: 'raw-1', versionId: 'v-1' })).resolves.toMatchObject({ versionId: 'v-1', sha256: 'a'.repeat(64), byteLength: CONTENT.length })
    expect(requests[0][0]).toContain('versionId=v-1')
    expect(requests[0][1].method).toBe('GET')
    expect(requests[1][1].method).toBe('HEAD')
  })

  it('fails closed when an exact read returns a different provider version', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(CONTENT, { status: 200, headers: { 'x-amz-version-id': 'v-other' } }))
    const port = createS3ObjectStoragePort({ endpoint: 'http://minio.internal:9000', accessKeyId: 'access', secretAccessKey: 'secret', bucket: 'knowledge-raw', fetchFn })
    await expect(port.readExact({ key: 'raw-1', versionId: 'v-1' })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_VERSION_MISMATCH' })
  })

  it('fails closed when the provider does not return a version and when configuration is disabled', async () => {
    const port = createS3ObjectStoragePort({ endpoint: 'http://minio.internal:9000', accessKeyId: 'access', secretAccessKey: 'secret', bucket: 'knowledge-raw', fetchFn: vi.fn().mockResolvedValue(new Response(null, { status: 200 })) })
    await expect(port.putImmutable({ key: 'raw-1', content: CONTENT })).rejects.toMatchObject({ code: 'KNOWLEDGE_STORAGE_VERSION_UNAVAILABLE' })
    expect(createConfiguredKnowledgeObjectStoragePort({})).toBeNull()
  })

  it('recovers only verified exact bytes after discovering an immutable version', async () => {
    const digest = createHash('sha256').update(CONTENT).digest('hex')
    const fetchFn = vi.fn(async (url, request) => request.method === 'HEAD'
      ? new Response(null, { headers: { 'x-amz-version-id': 'recovered' } })
      : new Response(CONTENT, { headers: { 'x-amz-version-id': 'recovered' } }))
    const port = createS3ObjectStoragePort({ endpoint: 'http://storage.test', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'knowledge-raw', fetchFn })
    await expect(port.recoverImmutable({ key: 'raw-1', expectedSha256: digest, byteLength: CONTENT.length })).resolves.toEqual({ key: 'raw-1', versionId: 'recovered', sha256: digest, byteLength: CONTENT.length })
    expect(fetchFn.mock.calls.map(([, request]) => request.method)).toEqual(['HEAD', 'GET'])
    expect(new URL(fetchFn.mock.calls[1][0]).searchParams.get('versionId')).toBe('recovered')
  })

  it.each(['missing-version', 'wrong-version', 'wrong-bytes', 'wrong-length', 'outage', 'not-found'])('fails closed during recovery: %s', async (failure) => {
    const digest = createHash('sha256').update(CONTENT).digest('hex')
    const fetchFn = vi.fn(async (url, request) => {
      if (request.method === 'HEAD') return new Response(null, { status: failure === 'outage' ? 503 : failure === 'not-found' ? 404 : 200,
        headers: failure === 'missing-version' ? {} : { 'x-amz-version-id': 'recovered' } })
      return new Response(failure === 'wrong-bytes' ? Buffer.alloc(CONTENT.length) : CONTENT,
        { headers: { 'x-amz-version-id': failure === 'wrong-version' ? 'other' : 'recovered' } })
    })
    const port = createS3ObjectStoragePort({ endpoint: 'http://storage.test', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'knowledge-raw', fetchFn })
    const result = port.recoverImmutable({ key: 'raw-1', expectedSha256: digest, byteLength: failure === 'wrong-length' ? CONTENT.length + 1 : CONTENT.length })
    if (failure === 'not-found') await expect(result).resolves.toBeNull()
    else await expect(result).rejects.toMatchObject({ code: failure === 'missing-version' ? 'KNOWLEDGE_STORAGE_VERSION_UNAVAILABLE'
      : failure === 'wrong-version' ? 'KNOWLEDGE_STORAGE_VERSION_MISMATCH' : failure === 'outage' ? 'KNOWLEDGE_STORAGE_PROVIDER_ERROR' : 'KNOWLEDGE_STORAGE_READBACK_MISMATCH' })
    expect(fetchFn.mock.calls.some(([, request]) => request.method === 'PUT')).toBe(false)
  })
})
