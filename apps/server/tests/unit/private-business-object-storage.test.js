// @req FR-137, FR-173, FR-253 — private business objects preserve purpose, scope and exact version.
// @spec ADR-115, SEC-001, SEC-024
// @tested src/platform/storage/private-business-object-storage.js
import { describe, expect, it, vi } from 'vitest'
import { createConfiguredAssetObjectStoragePort, createConfiguredKnowledgeCatalogObjectStoragePort, createConfiguredManagedBlobObjectStoragePort } from '@/platform/storage/supabase-object-storage'
import * as fixtureEvidence from '../helpers/compact-business-storage.mjs'
import { compactStorageDatabaseEnvironment } from '../helpers/compact-storage-database.mjs'

const env = {
  ZURI_ASSET_STORAGE_PROVIDER: 's3', ZURI_ASSET_EVIDENCE_BUCKET: 'asset-private',
  ZURI_ASSET_STORAGE_ENDPOINT: 'http://storage.test:9000', ZURI_ASSET_STORAGE_ACCESS_KEY: 'asset-access', ZURI_ASSET_STORAGE_SECRET_KEY: 'asset-secret',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_PROVIDER: 's3', ZURI_KNOWLEDGE_CATALOG_BUCKET: 'catalog-private',
  ZURI_KNOWLEDGE_CATALOG_STORAGE_ENDPOINT: 'http://storage.test:9000', ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY: 'catalog-access', ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY: 'catalog-secret',
  ZURI_KNOWLEDGE_STORAGE_BUCKET: 'knowledge-private',
}
const assetKey = 'asset-evidence/tenant-a/business-a/aa/a.pdf'
const catalogKey = 'business-catalog/tenant-a/business-a/aa/catalog.json'
const scope = { tenantId: 'tenant-a', businessId: 'business-a' }
const response = (status = 200, bytes = 'private bytes', version = 'v +/%?#') => new Response(bytes, { status, headers: { 'x-amz-version-id': version } })

describe('Compact private Asset/catalog storage', () => {
  it('does not qualify the real catalog consumer from generic object CRUD alone', () => {
    const completedCases = new Set(['upload', 'catalog', 'extraction', 'metadataFailure', 'versions', 'objectLoss', 'unversionedRefusal'])
    const result = fixtureEvidence.businessStorageObservation({ completedCases, cleanup: 'PASS' })
    expect(result.status).toBe('FAIL')
    expect(result.checks.pricingCatalogAdmission).toBe(false)
  })
  it.each([['integrity', 'metadataIntegrity'], ['pricingAdmission', 'pricingCatalogAdmission']])('requires completed %s assertions before reporting full parity', (omitted, check) => {
    const all = ['upload', 'catalog', 'extraction', 'integrity', 'pricingAdmission', 'metadataFailure', 'versions', 'objectLoss', 'unversionedRefusal']
    const result = fixtureEvidence.businessStorageObservation({ completedCases: new Set(all.filter(name => name !== omitted)), cleanup: 'PASS' })
    expect(result.status).toBe('FAIL')
    expect(result.checks[check]).toBe(false)
  })
  it.each([
    { expectedSha256: '0'.repeat(64) },
    { expectedByteLength: 1 },
  ])('refuses a pinned response inconsistent with persisted integrity %j', async expected => {
    const fetchFn = vi.fn().mockResolvedValue(response())
    const port = createConfiguredAssetObjectStoragePort(env, { fetchFn })
    const stored = await port.put({ key: assetKey, content: Buffer.from('private bytes') })
    await expect(port.get({ ref: stored.ref, ...scope, ...expected })).rejects.toMatchObject({ status: 409, code: 'BUSINESS_STORAGE_UNAVAILABLE' })
  })
  it.each([
    { expectedSha256: 'malformed' }, { expectedSha256: '' },
    ...['\n', '\r', '\r\n', '\u2028', '\u2029'].map(ending => ({ expectedSha256: 'a'.repeat(64) + ending })),
    { expectedByteLength: -1 }, { expectedByteLength: 1.5 },
  ])('refuses malformed integrity expectations before provider I/O %j', async expected => {
    const fetchFn = vi.fn().mockResolvedValue(response())
    const port = createConfiguredAssetObjectStoragePort(env, { fetchFn })
    const stored = await port.put({ key: assetKey, content: Buffer.from('private bytes') })
    fetchFn.mockClear()
    await expect(port.get({ ref: stored.ref, ...scope, ...expected })).rejects.toMatchObject({ status: 400 })
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('selects only the injected disposable database and removes every PostgreSQL alias', () => {
    const selected = compactStorageDatabaseEnvironment({ DATABASE_URL: 'postgresql://foreign.invalid/db', POSTGRES_PRISMA_URL: 'postgresql://foreign.invalid/db', POSTGRES_URL: 'postgresql://foreign.invalid/db', POSTGRES_URL_NON_POOLING: 'postgresql://foreign.invalid/db', DATABASE_POSTGRES_URL: 'postgresql://foreign.invalid/db' }, 'file:./.test-dbs/run-owned.db')
    expect(selected).toEqual({ DATABASE_URL: 'file:./.test-dbs/run-owned.db', DIRECT_URL: 'file:./.test-dbs/run-owned.db' })
    expect(() => compactStorageDatabaseEnvironment({}, 'postgresql://foreign.invalid/db')).toThrow('COMPACT_STORAGE_DISPOSABLE_DATABASE_REQUIRED')
    expect(() => compactStorageDatabaseEnvironment({}, 'file:./real.db')).toThrow('COMPACT_STORAGE_DISPOSABLE_DATABASE_REQUIRED')
  })
  it('reports PASS only after all actual cases and owned cleanup succeed', () => {
    expect(typeof fixtureEvidence.businessStorageObservation).toBe('function')
    const evidence = { runId: 'owned-run', environment: 'TEST' }, all = ['upload', 'catalog', 'extraction', 'integrity', 'pricingAdmission', 'metadataFailure', 'versions', 'objectLoss', 'unversionedRefusal']
    const partial = fixtureEvidence.businessStorageObservation({ evidence, completedCases: new Set(all.filter(name => name !== 'extraction')), cleanup: 'PASS' })
    expect(partial.status).toBe('FAIL'); expect(partial.checks.extractionRead).toBe(false)
    expect(fixtureEvidence.businessStorageObservation({ evidence, completedCases: new Set(all), cleanup: 'FAIL' }).status).toBe('FAIL')
    expect(fixtureEvidence.businessStorageObservation({ evidence, completedCases: new Set(all), cleanup: 'PASS' })).toMatchObject({ status: 'PASS', cleanup: 'PASS', checks: { extractionRead: true, exactErasePreservesOtherVersion: true } })
  })
  it.each([['asset', createConfiguredAssetObjectStoragePort, assetKey], ['catalog', createConfiguredKnowledgeCatalogObjectStoragePort, catalogKey]])('pins %s writes and exact reads/deletes without exposing an endpoint or credential', async (purpose, factory, key) => {
    const fetchFn = vi.fn().mockImplementation((_url, init) => Promise.resolve(response(init.method === 'DELETE' ? 204 : 200, init.method === 'DELETE' ? null : 'private bytes')))
    const port = factory(env, { fetchFn })
    const stored = await port.put({ key, content: Buffer.from('private bytes'), mime: 'application/pdf' })
    expect(stored.ref).toMatch(new RegExp(`^s3-business://${purpose}/`))
    expect(stored.ref).toContain('versionId=')
    expect(JSON.stringify(stored)).not.toMatch(/storage\.test|asset-secret|catalog-secret|access/)
    expect(fetchFn.mock.calls[0][1].headers['if-none-match']).toBe('*')
    await expect(port.get({ ref: stored.ref, ...scope })).resolves.toEqual(Buffer.from('private bytes'))
    await port.remove({ ref: stored.ref, ...scope })
    for (const [url, init] of fetchFn.mock.calls.slice(1)) {
      expect(new URL(url).searchParams.get('versionId')).toBe('v +/%?#')
      expect(['GET', 'DELETE']).toContain(init.method)
    }
  })

  it('dispatches only the configured purpose and refuses a foreign Business before bytes', async () => {
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(response()))
    const asset = await createConfiguredAssetObjectStoragePort(env, { fetchFn }).put({ key: assetKey, content: Buffer.from('x') })
    const catalog = await createConfiguredKnowledgeCatalogObjectStoragePort(env, { fetchFn }).put({ key: catalogKey, content: Buffer.from('{}') })
    const reader = createConfiguredManagedBlobObjectStoragePort(env, { fetchFn })
    await reader.get({ ref: asset.ref, ...scope }); await reader.get({ ref: catalog.ref, ...scope })
    const before = fetchFn.mock.calls.length
    await expect(reader.get({ ref: asset.ref, ...scope, businessId: 'business-b' })).rejects.toMatchObject({ status: 400 })
    await expect(reader.get({ ref: asset.ref, ...scope, tenantId: 'tenant-b' })).rejects.toMatchObject({ status: 400 })
    await expect(reader.get({ ref: asset.ref.replace('asset-private', 'foreign-bucket'), ...scope })).rejects.toMatchObject({ status: 400 })
    await expect(reader.get({ ref: asset.ref.replace('/asset/', '/catalog/'), ...scope })).rejects.toMatchObject({ status: 400 })
    await expect(reader.get({ ref: asset.ref.replace(/\?versionId=.*/, ''), ...scope })).rejects.toMatchObject({ status: 400 })
    await expect(reader.get({ ref: asset.ref + '&endpoint=http://evil.test', ...scope })).rejects.toMatchObject({ status: 400 })
    await expect(reader.get({ ref: 's3://foreign/key?versionId=v', ...scope })).rejects.toMatchObject({ status: 400 })
    expect(fetchFn).toHaveBeenCalledTimes(before)
  })

  it('fails closed for unknown providers, missing credentials, shared buckets and wrong key namespaces', async () => {
    const fetchFn = vi.fn()
    for (const changed of [
      { ZURI_ASSET_STORAGE_PROVIDER: 'typo' }, { ZURI_ASSET_STORAGE_SECRET_KEY: '' },
      { ZURI_KNOWLEDGE_CATALOG_BUCKET: 'asset-private' }, { ZURI_KNOWLEDGE_STORAGE_BUCKET: 'asset-private' },
    ]) expect(() => createConfiguredAssetObjectStoragePort({ ...env, ...changed }, { fetchFn })).toThrow()
    const port = createConfiguredAssetObjectStoragePort(env, { fetchFn })
    for (const key of [catalogKey, 'knowledge/raw/tenant-a/business-a/object', 'asset-evidence/tenant-a/business-a/../object', 'asset-evidence//business-a/object']) {
      await expect(port.put({ key, content: Buffer.from('x') })).rejects.toMatchObject({ status: 400 })
    }
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses duplicate writes and wrong/missing versions and strips provider exceptions', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response(412)).mockResolvedValueOnce(response(200, 'other', 'wrong')).mockRejectedValueOnce(new Error('asset-secret internal-url'))
    const port = createConfiguredAssetObjectStoragePort(env, { fetchFn })
    const stored = await port.put({ key: assetKey, content: Buffer.from('x') })
    await expect(port.put({ key: assetKey, content: Buffer.from('y') })).rejects.toMatchObject({ status: 409 })
    await expect(port.get({ ref: stored.ref, ...scope })).rejects.toMatchObject({ status: 409 })
    await expect(port.get({ ref: stored.ref, ...scope })).rejects.not.toThrow(/asset-secret|internal-url/)
    const missing = createConfiguredAssetObjectStoragePort(env, { fetchFn: vi.fn().mockResolvedValue(new Response('x')) })
    await expect(missing.put({ key: assetKey, content: Buffer.from('x') })).rejects.toMatchObject({ status: 503 })
  })

  it('refuses a null-version write without attempting an unversioned cleanup', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(response(200, 'x', 'null'))
    const port = createConfiguredAssetObjectStoragePort(env, { fetchFn })
    await expect(port.put({ key: assetKey, content: Buffer.from('x') })).rejects.toMatchObject({ status: 503 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, 'null'])('refuses an exact read with unverifiable version header %s', async version => {
    const fetchFn = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response('unverified', { headers: version ? { 'x-amz-version-id': version } : {} }))
    const port = createConfiguredAssetObjectStoragePort(env, { fetchFn })
    const good = await port.put({ key: assetKey, content: Buffer.from('x') })
    await expect(port.get({ ref: good.ref })).rejects.toMatchObject({ status: 503 })
  })

  it('refuses null refs before provider reads or cleanup', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(response())
    const port = createConfiguredAssetObjectStoragePort(env, { fetchFn }), good = await port.put({ key: assetKey, content: Buffer.from('x') })
    const invalid = good.ref.replace(/versionId=.*/, 'versionId=null'), before = fetchFn.mock.calls.length
    await expect(port.get({ ref: invalid })).rejects.toMatchObject({ status: 400 })
    await expect(port.remove({ ref: invalid })).rejects.toMatchObject({ status: 400 })
    expect(fetchFn).toHaveBeenCalledTimes(before)
  })
})
