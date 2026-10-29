// @req FR-292 — recovery descriptors bind exact persisted evidence, never routing or authority.
// @spec ADR-115
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parseRecoveryDescriptor, recoveryDescriptorForFile, verifyRecoveryContent,
  parseRecoveryRequest,
} from '@/modules/project-manager/application/managed-blob-recovery-contract'

const sha = value => createHash('sha256').update(value).digest('hex')
const bytes = Buffer.from('original bytes ไทย')
const file = {
  id: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222',
  businessId: '33333333-3333-4333-8333-333333333333', version: 1,
  storageKind: 'MANAGED_BLOB', status: 'ACTIVE', deletedAt: null, mime: 'application/pdf',
  blobRef: 's3-business://asset/asset-private/asset-evidence/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/original/file.pdf?versionId=v1',
  size: bytes.length, sha256: sha(bytes),
}
const descriptor = () => recoveryDescriptorForFile(file)

describe('OR1 pure recovery protocol', () => {
  it('derives only matching evidence from the row, and round trips whitespace JSON', () => {
    const value = descriptor()
    expect(value).toEqual({ schemaVersion: 1, fileId: file.id, fileVersion: 1,
      tenantId: file.tenantId, businessId: file.businessId, purpose: 'asset',
      sourceRefSha256: sha(file.blobRef), sha256: file.sha256, byteLength: file.size })
    expect(parseRecoveryDescriptor(Buffer.from(JSON.stringify(value, null, 2)))).toEqual(value)
    expect(JSON.stringify(value)).not.toContain('asset-private')
  })
  it.each([
    { schemaVersion: 2 }, { fileId: 'not-uuid' }, { fileVersion: 0 }, { fileVersion: 1.5 },
    { byteLength: -1 }, { byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { purpose: 'knowledge' }, { sha256: 'A'.repeat(64) }, { sourceRefSha256: null },
    { endpoint: 'http://untrusted.test' }, { fileVersion: '1' },
  ])('refuses malformed or untrusted fields %j', patch => {
    expect(() => parseRecoveryDescriptor(JSON.stringify({ ...descriptor(), ...patch })))
      .toThrow('Recovery request refused')
  })
  it('applies the owning Asset 20 MiB and catalog 16 MiB policies below the recovery ceiling', () => {
    for (const [purpose, cap] of [['asset', 20 * 1024 * 1024], ['catalog', 16 * 1024 * 1024]]) {
      expect(parseRecoveryDescriptor(JSON.stringify({ ...descriptor(), purpose, byteLength: cap })).byteLength).toBe(cap)
      expect(() => parseRecoveryDescriptor(JSON.stringify({ ...descriptor(), purpose, byteLength: cap + 1 })))
        .toThrow('Recovery request refused')
    }
  })
  it('rejects oversize, BOM, invalid UTF-8, duplicate escaped keys, nesting and malformed JSON safely', () => {
    for (const input of [Buffer.alloc(65537), Buffer.from('\ufeff{}'), Buffer.from([0xff]),
      '{"schemaVersion":1,"schema\\u0056ersion":1}', '['.repeat(40) + ']'.repeat(40), '{secret']) {
      expect(() => parseRecoveryDescriptor(input)).toThrow('Recovery request refused')
    }
  })
  it.each([
    { status: 'QUARANTINED' }, { status: 'MISSING' }, { deletedAt: new Date() },
    { storageKind: 'LOCAL_FILE' }, { sha256: null }, { size: 20 * 1024 * 1024 + 1 },
    { version: null }, { blobRef: file.blobRef.replace('versionId=v1', 'versionId=null') },
    { tenantId: '44444444-4444-4444-8444-444444444444' },
    { blobRef: file.blobRef.replace('/original/', '/../') },
  ])('refuses ineligible or inconsistent persisted evidence %j', patch => {
    expect(() => recoveryDescriptorForFile({ ...file, ...patch })).toThrow('Recovery request refused')
  })
  it('verifies the actual bytes against every descriptor field without mutating the caller', async () => {
    const value = descriptor()
    await expect(verifyRecoveryContent(value, [bytes.subarray(0, 2), bytes.subarray(2)], value))
      .resolves.toEqual({ sha256: file.sha256, byteLength: file.size })
    for (const field of Object.keys(value)) {
      const changed = { ...value, [field]: field === 'byteLength' ? value.byteLength + 1 : 'changed' }
      await expect(verifyRecoveryContent(changed, [bytes], value)).rejects.toThrow('Recovery request refused')
    }
    await expect(verifyRecoveryContent(value, [Buffer.from('wrong')], value)).rejects.toThrow('Recovery request refused')
    expect(bytes.toString()).toBe('original bytes ไทย')
  })
  it('enforces actual streamed length and stops without reading the rest', async () => {
    let consumed = 0, closed = false
    async function* stream() {
      try { consumed++; yield Buffer.alloc(file.size + 1); consumed++; yield Buffer.alloc(1) }
      finally { closed = true }
    }
    await expect(verifyRecoveryContent(descriptor(), stream(), descriptor())).rejects.toMatchObject({ status: 413 })
    expect(consumed).toBe(1)
    expect(closed).toBe(true)
  })
  it('sanitizes broken streams and rejects strings or nonbyte chunks', async () => {
    async function* broken() { throw new Error('provider secret endpoint') }
    for (const stream of [broken(), ['bytes'], 'bytes', null]) {
      await expect(verifyRecoveryContent(descriptor(), stream, descriptor())).rejects.toThrow('Recovery request refused')
    }
  })
  it('strictly validates preparation/confirmation/inspection DTOs without accepting caller scope', () => {
    expect(parseRecoveryRequest('prepare', { expectedVersion: 1 })).toEqual({ expectedVersion: 1 })
    expect(parseRecoveryRequest('inspect', {})).toEqual({})
    expect(parseRecoveryRequest('confirm', { confirmationBinding: Buffer.alloc(32, 1).toString('base64url'), expectedOperationVersion: 1 }))
      .toHaveProperty('expectedOperationVersion', 1)
    for (const [kind, value] of [['prepare', { expectedVersion: 1, businessId: file.businessId }],
      ['confirm', { confirmationBinding: 'short', expectedOperationVersion: 1 }], ['inspect', { ref: 'x' }], ['unknown', {}], ['__proto__', {}]]) {
      expect(() => parseRecoveryRequest(kind, value)).toThrow('Recovery request refused')
    }
  })
})
