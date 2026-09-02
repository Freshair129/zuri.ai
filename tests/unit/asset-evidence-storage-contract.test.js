// @req FR-137 — verified private evidence creates one opaque managed object.
// @spec SDD-081, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-storage-contract.test.js
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

async function optionalModule(relativePath) {
  try { return await import(pathToFileURL(path.resolve(relativePath)).href) } catch { return null }
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PDF = Buffer.from('%PDF-1.7\n')

describe('FR-137 Asset evidence content and storage boundary', () => {
  it('verifies supported content from bytes and produces a content-addressed private key', async () => {
    const policy = await optionalModule('src/modules/asset-management/domain/evidence-policy.js')
    expect(policy, 'evidence policy must exist').not.toBeNull()
    if (!policy) return

    expect(policy.inspectAssetEvidence({ content: JPEG, declaredMime: 'image/jpeg', name: 'slip.jpg' }))
      .toMatchObject({ mime: 'image/jpeg', size: JPEG.length, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(policy.inspectAssetEvidence({ content: PDF, declaredMime: 'application/pdf', name: 'receipt.pdf' }))
      .toMatchObject({ mime: 'application/pdf' })
    expect(policy.buildAssetEvidenceObjectKey({ tenantId: 'tenant-a', businessId: 'business-a', sha256: 'a'.repeat(64), name: 'ใบเสร็จ 1.pdf' }))
      .toMatch(/^asset-evidence\/tenant-a\/business-a\/aa\/a{64}-[^/]+\.pdf$/)
  })

  it('rejects type spoofing, unsupported content and the 20 MiB boundary before storage', async () => {
    const policy = await optionalModule('src/modules/asset-management/domain/evidence-policy.js')
    expect(policy, 'evidence policy must exist').not.toBeNull()
    if (!policy) return

    expect(() => policy.inspectAssetEvidence({ content: PDF, declaredMime: 'image/jpeg', name: 'fake.jpg' }))
      .toThrow(/does not match/i)
    expect(() => policy.inspectAssetEvidence({ content: Buffer.from('MZ'), declaredMime: 'application/octet-stream', name: 'run.exe' }))
      .toThrow(/unsupported/i)
    expect(() => policy.inspectAssetEvidence({ content: Buffer.alloc(20 * 1024 * 1024 + 1, 0xff), declaredMime: 'image/jpeg', name: 'large.jpg' }))
      .toThrow(/20 MiB/i)
  })

  it('uses server credentials, no upsert and opaque refs without exposing a public URL', async () => {
    const storage = await optionalModule('src/platform/storage/supabase-object-storage.js')
    expect(storage, 'Supabase object adapter must exist').not.toBeNull()
    if (!storage) return

    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Key: 'private/evidence.pdf' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const port = storage.createSupabaseObjectStoragePort({
      baseUrl: 'https://example.supabase.co', serviceRoleKey: 'server-secret',
      bucket: 'asset-evidence', fetchFn,
    })
    const result = await port.put({ key: 'tenant/business/evidence.pdf', content: PDF, mime: 'application/pdf' })

    const [url, request] = fetchFn.mock.calls[0]
    expect(url).toBe('https://example.supabase.co/storage/v1/object/asset-evidence/tenant/business/evidence.pdf')
    expect(request).toMatchObject({ method: 'POST', body: PDF })
    expect(request.headers).toMatchObject({
      apikey: 'server-secret', Authorization: 'Bearer server-secret',
      'Content-Type': 'application/pdf', 'x-upsert': 'false',
    })
    expect(result).toEqual({ ref: 'supabase://asset-evidence/tenant/business/evidence.pdf' })
    expect(JSON.stringify(result)).not.toContain('server-secret')
    expect(JSON.stringify(result)).not.toContain('https://')
  })

  it('does not reflect provider response bodies through storage errors', async () => {
    const storage = await optionalModule('src/platform/storage/supabase-object-storage.js')
    expect(storage).not.toBeNull()
    if (!storage) return
    const port = storage.createSupabaseObjectStoragePort({
      baseUrl: 'https://example.supabase.co', serviceRoleKey: 'server-secret', bucket: 'asset-evidence',
      fetchFn: vi.fn().mockResolvedValue(new Response('provider-internal-secret', { status: 500 })),
    })
    await expect(port.put({ key: 'private/evidence.pdf', content: PDF, mime: 'application/pdf' }))
      .rejects.not.toThrow(/provider-internal-secret/)
  })
})
