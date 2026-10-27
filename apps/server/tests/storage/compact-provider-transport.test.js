// @spec ADR-115 — observed selected TEST provider/command, not license or release approval.
// @tested scripts/compact-package.mjs
import { it, expect } from 'vitest'
import { randomUUID, createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { startCompactBusinessStorage } from '../helpers/compact-business-storage.mjs'
import { readCompactPrivateFile } from '../../scripts/lib/compact/executor.mjs'
import { createS3ObjectStoragePort } from '@/platform/storage/s3-object-storage'

it('observes immutable version/conditional write/exact read/exact erase on the explicitly supplied provider', async () => {
  const input = JSON.parse(await readCompactPrivateFile(process.env.COMPACT_PROVIDER_INPUT_FILE))
  const checks = { versioning: false, conditionalWrite: false, exactRead: false, exactErase: false }
  let f, cleanup = 'FAIL', firstError
  try {
    f = await startCompactBusinessStorage(input)
    expect(f.evidence.reference).toBe(input.image); expect(f.evidence.command).toEqual(input.command)
    const port = createS3ObjectStoragePort({ endpoint: f.endpoint, bucket: f.buckets.catalog, accessKeyId: f.env.ZURI_KNOWLEDGE_CATALOG_STORAGE_ACCESS_KEY, secretAccessKey: f.env.ZURI_KNOWLEDGE_CATALOG_STORAGE_SECRET_KEY })
    const key = `business-catalog/test/test/transport/${randomUUID()}.json`, content = Buffer.from('{"transport":"first"}')
    const stored = await port.putImmutable({ key, content, contentType: 'application/json' })
    expect(typeof stored.versionId).toBe('string'); expect(stored.versionId.toLowerCase()).not.toBe('null'); expect(stored.versionId.trim()).not.toBe(''); checks.versioning = true
    await expect(port.putImmutable({ key, content, contentType: 'application/json' })).rejects.toMatchObject({ status: 409 }); checks.conditionalWrite = true
    const replacement = Buffer.from('{"transport":"second"}')
    await f.replaceForVersionTest({ bucket: f.buckets.catalog, key, content: replacement })
    const latest = await port.recoverImmutable({ key, expectedSha256: createHash('sha256').update(replacement).digest('hex'), byteLength: replacement.length })
    expect((await port.readExact({ key, versionId: stored.versionId })).bytes).toEqual(content); checks.exactRead = true
    await port.eraseExactVersions({ key, versionIds: [stored.versionId] })
    await expect(port.readExact({ key, versionId: stored.versionId })).rejects.toMatchObject({ status: 404 })
    expect((await port.readExact(latest)).bytes).toEqual(replacement); checks.exactErase = true
  } catch (error) { firstError = error } finally {
    try { if (f) { await f.close(); cleanup = 'PASS' } } catch (error) { firstError ||= error }
    if (process.env.COMPACT_PROVIDER_EVIDENCE_FILE) await writeFile(process.env.COMPACT_PROVIDER_EVIDENCE_FILE, JSON.stringify({ status: Object.values(checks).every(Boolean) && cleanup === 'PASS' ? 'PASS' : 'FAIL', environment: 'TEST', image: input.image, platform: 'linux/amd64', command: input.command, checks }, null, 2), { flag: 'wx', mode: 0o600 })
  }
  if (firstError) throw firstError
})
