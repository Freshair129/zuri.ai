// @req FR-293 — pure transfer wire validation is consistency evidence, never restore authority.
// @spec ADR-115
import { describe, expect, it } from 'vitest'
import { canonicalJSON } from '@/modules/project-manager/application/handoff-contract'
import { recoverySha256 as sha } from '@/modules/project-manager/application/managed-blob-recovery-contract'
import { encodeManagedBlobTransfer, decodeManagedBlobTransfer } from '@/modules/project-manager/application/managed-blob-transfer-contract'

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
const profile = { maxManifestBytes: 65536, maxSnapshotBytes: 1048576, maxEntries: 16,
  maxBindings: 64, maxOriginalBytes: 1048576, maxPackageBytes: 2097152 }
function fixture(count = 1) {
  const business = { id: id(1), tenantId: id(2) }
  const snapshot = { schemaVersion: '1.0', exportedAt: '2026-10-30T00:00:00.000Z', tables: {
    business: [business], workspace: [{ id: id(3), businessId: business.id, tenantId: business.tenantId, scopeType: 'BUSINESS' }],
    project: [{ id: id(4), businessId: business.id, workspaceId: id(3) }], fileAsset: [], projectFile: [],
  } }
  const entries = [], objects = new Map()
  for (let i = 0; i < count; i++) {
    const bytes = Buffer.from(`original ไทย ${i}`), purpose = i % 2 ? 'catalog' : 'asset'
    const objectId = id(10 + i)
    const blobRef = `s3-business://${purpose}/${purpose}-private/${purpose === 'asset' ? 'asset-evidence' : 'business-catalog'}/${business.tenantId}/${business.id}/recovery/${id(20 + i)}/original?versionId=v1`
    const row = { id: id(30 + i), businessId: business.id, tenantId: business.tenantId,
      storageKind: 'MANAGED_BLOB', blobRef, sha256: sha(bytes), size: bytes.length,
      name: 'ต้นฉบับ', mime: 'application/octet-stream', deletedAt: i ? '2026-10-29T00:00:00.000Z' : null,
      createdAt: '2026-10-28T00:00:00.000Z', version: 1 }
    snapshot.tables.fileAsset.push(row)
    const bindings = [{ model: 'fileAsset', id: row.id, tenantId: row.tenantId, businessId: row.businessId,
      sourceRowSha256: sha(canonicalJSON(row)), sourceRefSha256: sha(blobRef) }]
    if (i === 0) {
      const alias = { id: id(40), projectId: id(4), blobRef, size: row.size, mime: row.mime, version: 1 }
      snapshot.tables.projectFile.push(alias)
      bindings.push({ model: 'projectFile', id: alias.id, tenantId: row.tenantId, businessId: row.businessId,
        sourceRowSha256: sha(canonicalJSON(alias)), sourceRefSha256: sha(blobRef) })
    }
    entries.push({ objectId, sha256: sha(bytes), byteLength: bytes.length, purpose, bindings })
    objects.set(objectId, bytes)
  }
  const snapshotBytes = Buffer.from(canonicalJSON(snapshot))
  const manifest = { schemaVersion: 'compact-managed-blob-backup.v1', sourceRevision: 'a'.repeat(40),
    exportedAt: '2026-10-30T00:00:00.000Z', snapshotSha256: sha(snapshotBytes), sourceGeneration: 1,
    sourceConfigSha256: 'b'.repeat(64), entryCount: entries.length,
    totalOriginalBytes: [...objects.values()].reduce((sum, bytes) => sum + bytes.length, 0), entries }
  return { snapshot, snapshotBytes, manifest, objects }
}
function encode(value = fixture(), selected = profile) { return encodeManagedBlobTransfer(value, selected) }

describe('OR1 transfer consistency codec (no import, provider or authority effects)', () => {
  it.each([0, 1, 2])('round trips canonical %i-entry bytes including Unicode, dates, null and aliases/tombstones', count => {
    const value = fixture(count), original = structuredClone(value.snapshot)
    const tar = encode(value)
    const decoded = decodeManagedBlobTransfer(tar, profile)
    expect(decoded.snapshot).toEqual(original)
    expect(decoded.snapshotBytes).toEqual(value.snapshotBytes)
    expect(decoded.manifest).toEqual(value.manifest)
    expect(decoded.objects).toEqual(value.objects)
    expect(decoded.packageSha256).toBe(sha(tar))
    expect(encodeManagedBlobTransfer(decoded, profile)).toEqual(tar)
    expect(value.snapshot).toEqual(original)
  })
  it('matches independently generated fixed golden SHA256s', () => {
    // Filled from an independent Python reference encoder before implementation.
    expect([0, 1, 2].map(count => sha(encode(fixture(count))))).toEqual([
      '6e806812c131e6fd52b54d14ec1e0e317cb72f62f8c71f7b819a468c043eeb7f',
      '25d9305b1aeb91b79cf008854362a43006fc32d4cc7d802ace34100f925b56f6',
      'b053f9de78655872e46e2b8e74ecb16dcae6703d80f39a966644cd4a65359c4d',
    ])
  })
  it('freezes parsed evidence and owns byte copies; changed bytes must be revalidated', () => {
    const source = encode(), result = decodeManagedBlobTransfer(source, profile)
    expect(() => { result.manifest.entries[0].purpose = 'catalog' }).toThrow(TypeError)
    expect(() => { result.snapshot.tables.fileAsset[0].businessId = id(99) }).toThrow(TypeError)
    const original = Buffer.from(result.snapshotBytes)
    source.fill(0)
    expect(result.snapshotBytes).toEqual(original)
    // Uint8Array/Map are byte custody, not immutable authority receipts. Any
    // eventual orchestrator must rehash its sealed bytes before using them.
    result.objects.values().next().value.fill(0)
    expect(() => encodeManagedBlobTransfer(result, profile)).toThrow('Managed blob transfer refused')
  })
  it.each([
    { unknown: true }, { sourceRevision: 'wrong' }, { sourceGeneration: 0 },
    { exportedAt: '2026-02-30T00:00:00.000Z' }, { entryCount: 99 }, { totalOriginalBytes: 0 },
    { snapshotSha256: '0'.repeat(64) }, { sourceConfigSha256: 'B'.repeat(64) },
  ])('rejects malformed root or mismatched count/digest %j', patch => {
    const value = fixture(); Object.assign(value.manifest, patch)
    expect(() => encode(value)).toThrow('Managed blob transfer refused')
  })
  it('requires explicit finite profile budgets and checks actual package/entry/manifest/snapshot/byte limits', () => {
    expect(() => encodeManagedBlobTransfer(fixture())).toThrow('Managed blob transfer refused')
    for (const key of Object.keys(profile)) {
      expect(() => encode(fixture(2), { ...profile, [key]: Infinity })).toThrow('Managed blob transfer refused')
      expect(() => encode(fixture(2), { ...profile, [key]: 1 })).toThrow('Managed blob transfer refused')
    }
    expect(() => decodeManagedBlobTransfer(Buffer.alloc(1024), { ...profile, maxPackageBytes: 512 })).toThrow('Managed blob transfer refused')
  })
  it('refuses a real catalog original above its owning 16 MiB cap even with a larger transfer budget', () => {
    const value = fixture(2), entry = value.manifest.entries[1], row = value.snapshot.tables.fileAsset[1]
    const bytes = Buffer.alloc(16 * 1024 * 1024 + 1)
    value.objects.set(entry.objectId, bytes)
    row.size = bytes.length; row.sha256 = sha(bytes)
    entry.byteLength = bytes.length; entry.sha256 = row.sha256
    entry.bindings[0].sourceRowSha256 = sha(canonicalJSON(row))
    value.snapshotBytes = Buffer.from(canonicalJSON(value.snapshot)); value.manifest.snapshotSha256 = sha(value.snapshotBytes)
    value.manifest.totalOriginalBytes = [...value.objects.values()].reduce((sum, item) => sum + item.length, 0)
    expect(() => encode(value, { ...profile, maxOriginalBytes: 64 * 1024 * 1024, maxPackageBytes: 64 * 1024 * 1024 }))
      .toThrow('Managed blob transfer refused')
  })
  it.each(['missing-binding', 'extra-binding', 'duplicate-binding', 'wrong-scope', 'wrong-row-hash', 'wrong-ref-hash',
    'missing-witness', 'wrong-bytes', 'extra-object', 'missing-object', 'duplicate-row', 'inconsistent-graph', 'duplicate-ref-entry'])
  ('refuses %s without silently omitting rows or remapping refs', kind => {
    const value = fixture(), entry = value.manifest.entries[0], binding = entry.bindings[0]
    if (kind === 'missing-binding') entry.bindings.pop()
    if (kind === 'extra-binding') entry.bindings.push({ ...binding, id: id(99) })
    if (kind === 'duplicate-binding') entry.bindings.push({ ...binding })
    if (kind === 'wrong-scope') binding.businessId = id(99)
    if (kind === 'wrong-row-hash') binding.sourceRowSha256 = '0'.repeat(64)
    if (kind === 'wrong-ref-hash') binding.sourceRefSha256 = '0'.repeat(64)
    if (kind === 'missing-witness') value.snapshot.tables.fileAsset = []
    if (kind === 'wrong-bytes') value.objects.set(entry.objectId, Buffer.from('wrong'))
    if (kind === 'extra-object') value.objects.set(id(99), Buffer.from('extra'))
    if (kind === 'missing-object') value.objects.clear()
    if (kind === 'duplicate-row') value.snapshot.tables.fileAsset.push({ ...value.snapshot.tables.fileAsset[0] })
    if (kind === 'inconsistent-graph') value.snapshot.tables.workspace[0].businessId = id(99)
    if (kind === 'duplicate-ref-entry') {
      const extra = structuredClone(entry); extra.objectId = id(99)
      value.manifest.entries.push(extra); value.manifest.entryCount++
      value.manifest.totalOriginalBytes *= 2; value.objects.set(extra.objectId, value.objects.get(entry.objectId))
    }
    value.snapshotBytes = Buffer.from(canonicalJSON(value.snapshot)); value.manifest.snapshotSha256 = sha(value.snapshotBytes)
    expect(() => encode(value)).toThrow('Managed blob transfer refused')
  })
  it('refuses noncanonical JSON and duplicate JSON keys before semantic reserialization', () => {
    for (const transform of [text => text + '\n', text => text.replace('{', '{"schemaVersion":"1.0",'), text => '\ufeff' + text]) {
      const value = fixture(); value.snapshotBytes = Buffer.from(transform(value.snapshotBytes.toString()))
      value.manifest.snapshotSha256 = sha(value.snapshotBytes)
      expect(() => encode(value)).toThrow('Managed blob transfer refused')
    }
  })
  it('rejects noncanonical headers, paths, links, padding, order, truncation and trailing records', () => {
    const tar = encode()
    for (const [offset, byte] of [[0, 47], [100, 49], [148, 49], [156, 50], [157, 120], [265, 120]]) {
      const corrupt = Buffer.from(tar); corrupt[offset] = byte
      expect(corrupt).not.toEqual(tar)
      expect(() => decodeManagedBlobTransfer(corrupt, profile)).toThrow('Managed blob transfer refused')
    }
    const manifestLength = Buffer.byteLength(canonicalJSON(fixture().manifest))
    const padding = Buffer.from(tar); padding[512 + manifestLength] = 1
    for (const invalid of [padding, tar.subarray(0, -1), Buffer.concat([tar, Buffer.alloc(512)]),
      Buffer.concat([tar.subarray(512), tar.subarray(0, 512)])]) {
      expect(() => decodeManagedBlobTransfer(invalid, profile)).toThrow('Managed blob transfer refused')
    }
  })
  it.each(['managedBlobRecoveryOperation', 'managedBlobRecoveryInstallationFence', 'managedBlobBackupTransferJob', 'managedBlobBackupTransferEntry'])
  ('refuses source control-state table %s rather than exporting it', model => {
    const value = fixture(); value.snapshot.tables[model] = []
    value.snapshotBytes = Buffer.from(canonicalJSON(value.snapshot)); value.manifest.snapshotSha256 = sha(value.snapshotBytes)
    expect(() => encode(value)).toThrow('Managed blob transfer refused')
  })
  it('preserves existing snapshot fields as data without interpreting them as restored authority', () => {
    const value = fixture()
    value.snapshot.tables.session = [{ id: id(90), status: 'REVOKED', tokenHash: 'c'.repeat(64) }]
    value.snapshotBytes = Buffer.from(canonicalJSON(value.snapshot)); value.manifest.snapshotSha256 = sha(value.snapshotBytes)
    const result = decodeManagedBlobTransfer(encode(value), profile)
    expect(result.snapshot.tables.session).toEqual(value.snapshot.tables.session)
    expect(result).not.toHaveProperty('authority')
  })
  it.each(['fileAsset', 'projectFile', 'business', 'project', 'workspace'])
  ('refuses absent/null/non-array %s inventory instead of claiming empty coverage', model => {
    for (const replacement of [undefined, null, {}]) {
      const value = fixture(0)
      if (replacement === undefined) delete value.snapshot.tables[model]
      else value.snapshot.tables[model] = replacement
      value.snapshotBytes = Buffer.from(canonicalJSON(value.snapshot)); value.manifest.snapshotSha256 = sha(value.snapshotBytes)
      expect(() => encode(value)).toThrow('Managed blob transfer refused')
    }
  })
})
