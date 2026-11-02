// @req FR-293 — raw package custody is bounded, private and server-owned.
// @spec ADR-115
// @tested tests/unit/managed-blob-transfer-spool.test.js
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createManagedBlobTransferSpool } from '@/modules/project-manager/application/managed-blob-transfer-spool'

let root
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = null })
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const chunks = bytes => [bytes.subarray(0, 3), bytes.subarray(3)]

describe('FR-293 bounded transfer spool', () => {
  it('accepts Windows case and namespace aliases for the same private spool root', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'zuri-transfer-spool-'))
    const dataDirectory = process.platform === 'win32' ? path.toNamespacedPath(root.toUpperCase()) : root
    const spool = createManagedBlobTransferSpool(dataDirectory), id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const bytes = Buffer.from('case-insensitive Windows root')
    await expect(spool.write(id, chunks(bytes), { maxBytes: 1024, deadline: Date.now() + 5000 }))
      .resolves.toEqual({ byteLength: bytes.length, sha256: digest(bytes) })
  })

  it('stores and reads only an exact byte count and digest under an opaque server id', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'zuri-transfer-spool-'))
    const spool = createManagedBlobTransferSpool(root), id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const bytes = Buffer.from('original ไทย package')
    await expect(spool.write(id, chunks(bytes), { maxBytes: 1024, deadline: Date.now() + 5000 }))
      .resolves.toEqual({ byteLength: bytes.length, sha256: digest(bytes) })
    await expect(spool.read(id, { byteLength: bytes.length, sha256: digest(bytes) })).resolves.toEqual(bytes)
    await expect(spool.read(id, { byteLength: bytes.length - 1, sha256: digest(bytes) })).rejects.toThrow()
    expect(await readdir(path.join(root, 'managed-blob-transfer-private'))).toEqual([id])
  })

  it('refuses excess bytes and unsafe ids before leaving owned temporary files', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'zuri-transfer-spool-'))
    const spool = createManagedBlobTransferSpool(root), id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await expect(spool.write(id, [Buffer.alloc(5)], { maxBytes: 4, deadline: Date.now() + 5000 })).rejects.toThrow()
    await expect(spool.read('../outside', { byteLength: 0, sha256: digest(Buffer.alloc(0)) })).rejects.toThrow()
    expect(await readdir(path.join(root, 'managed-blob-transfer-private'))).toEqual([])
  })

  it('keeps a durable export snapshot separate from the final package and removes only the job artifacts', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'zuri-transfer-spool-'))
    const spool = createManagedBlobTransferSpool(root), id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const snapshot = Buffer.from('{"selection":"immutable"}'), packageBytes = Buffer.from('sealed package')
    const snapshotReceipt = await spool.write(id, [snapshot], { artifact: 'snapshot', maxBytes: 1024,
      deadline: Date.now() + 5000 })
    const packageReceipt = await spool.write(id, [packageBytes], { maxBytes: 1024, deadline: Date.now() + 5000 })
    await expect(spool.read(id, { artifact: 'snapshot', ...snapshotReceipt, maxBytes: 1024 })).resolves.toEqual(snapshot)
    await expect(spool.read(id, { ...packageReceipt, maxBytes: 1024 })).resolves.toEqual(packageBytes)
    expect((await readdir(path.join(root, 'managed-blob-transfer-private'))).sort()).toEqual([`${id}.snapshot`, id].sort())
    await spool.remove(id)
    expect(await readdir(path.join(root, 'managed-blob-transfer-private'))).toEqual([])
  })
})
