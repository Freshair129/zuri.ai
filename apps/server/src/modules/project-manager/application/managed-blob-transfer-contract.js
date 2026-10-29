// @req FR-293 — bounded canonical transfer bytes and complete reserved-ref witnesses.
// @spec ADR-115
// @tested tests/unit/managed-blob-transfer-contract.test.js
import { z } from 'zod'
import { canonicalJSON } from './handoff-contract'
import { readRecoveryJSON, recoverySha256 as sha, recoveryContentLimit } from './managed-blob-recovery-contract'
import { parseBusinessObjectRef } from '@/platform/storage/private-business-object-storage'

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const uint = z.number().int().nonnegative().safe()
const positive = uint.refine(value => value > 0)
const bindingSchema = z.object({ model: z.enum(['fileAsset', 'projectFile']), id: uuid,
  tenantId: uuid, businessId: uuid, sourceRowSha256: hash, sourceRefSha256: hash }).strict()
const entrySchema = z.object({ objectId: uuid, sha256: hash, byteLength: uint,
  purpose: z.enum(['asset', 'catalog']), bindings: z.array(bindingSchema).nonempty() }).strict()
const manifestSchema = z.object({ schemaVersion: z.literal('compact-managed-blob-backup.v1'),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  exportedAt: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    .refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value),
  snapshotSha256: hash, sourceGeneration: positive, sourceConfigSha256: hash,
  entryCount: uint, totalOriginalBytes: uint, entries: z.array(entrySchema) }).strict()
const profileSchema = z.object({ maxManifestBytes: positive, maxSnapshotBytes: positive,
  maxEntries: positive, maxBindings: positive, maxOriginalBytes: positive, maxPackageBytes: positive }).strict()
const fail = () => { throw new Error('Managed blob transfer refused') }
const bytesFor = value => {
  if (!(value instanceof Uint8Array)) fail()
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}
function canonicalBytes(value) { return Buffer.from(canonicalJSON(value)) }
function freezeJSON(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJSON(child)
    Object.freeze(value)
  }
  return value
}
function canonicalRead(bytes, limit) {
  const result = readRecoveryJSON(bytes, limit)
  if (!canonicalBytes(result).equals(bytes)) fail()
  return result
}

function header(name, length) {
  if (!/^(transfer\.json|snapshot\.json|obj_[a-f0-9-]{36}\.bin)$/.test(name)
    || !Number.isSafeInteger(length) || length < 0 || length > 0o77777777777) fail()
  const result = Buffer.alloc(512)
  const write = (text, offset) => result.write(text, offset, 'ascii')
  write(name, 0); write('0000600\0', 100); write('0000000\0', 108); write('0000000\0', 116)
  write(length.toString(8).padStart(11, '0') + '\0', 124); write('00000000000\0', 136)
  write('        ', 148); write('0', 156); write('ustar\0', 257); write('00', 263)
  write('0000000\0', 329); write('0000000\0', 337)
  const sum = result.reduce((a, b) => a + b, 0)
  write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return result
}

function rowMap(tables, model) {
  const rows = tables[model]
  if (!Array.isArray(rows)) fail()
  const map = new Map()
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || map.has(row.id)) fail()
    map.set(row.id, row)
  }
  return map
}

// No session, grant, target mapping, provider selection or family-admission
// decision is derived here. The backup service's existing protected-family and
// credential refusals must run again in the future authorized orchestrator.
function reservedInventory(snapshot) {
  if (snapshot?.schemaVersion !== '1.0' || !snapshot.tables || Array.isArray(snapshot.tables)) fail()
  const { tables } = snapshot
  // Existing snapshot identity/history fields remain byte-for-byte evidence.
  // Recovery/transfer control state is target-local and never portable.
  for (const model of ['managedBlobRecoveryOperation', 'managedBlobRecoveryInstallationFence',
    'managedBlobBackupTransferJob', 'managedBlobBackupTransferEntry']) if (Object.hasOwn(tables, model)) fail()
  const businesses = rowMap(tables, 'business'), projects = rowMap(tables, 'project'), workspaces = rowMap(tables, 'workspace')
  const files = rowMap(tables, 'fileAsset'), legacy = rowMap(tables, 'projectFile'), inventory = new Map()
  const witnesses = new Map()
  for (const [model, rows] of [['fileAsset', files], ['projectFile', legacy]]) for (const row of rows.values()) {
    if (typeof row.blobRef !== 'string' || !row.blobRef.startsWith('s3-business:')) continue
    const ref = parseBusinessObjectRef(row.blobRef), parts = ref.key.split('/')
    if (parts.length < 5 || parts[0] !== (ref.purpose === 'asset' ? 'asset-evidence' : 'business-catalog')
      || parts.some(part => !part || part === '.' || part === '..' || /[\\?#\x00-\x1f\x7f]/.test(part))) fail()
    if (parts[3] !== 'recovery') continue
    if (parts.length < 6 || !uuid.safeParse(parts[4]).success) fail()
    let businessId = row.businessId
    if (model === 'projectFile') {
      const project = projects.get(row.projectId), workspace = workspaces.get(project?.workspaceId)
      businessId = project?.businessId || workspace?.businessId
      if (!project || !workspace || (workspace.businessId && workspace.businessId !== businessId)) fail()
      const business = businesses.get(businessId)
      if (workspace.tenantId && workspace.tenantId !== business?.tenantId) fail()
    }
    const business = businesses.get(businessId), tenantId = business?.tenantId
    if (!business || !uuid.safeParse(businessId).success || !uuid.safeParse(tenantId).success
      || parts[1] !== tenantId || parts[2] !== businessId
      || model === 'fileAsset' && (row.tenantId !== tenantId || row.storageKind !== 'MANAGED_BLOB')) fail()
    const record = { model, row, tenantId, businessId, purpose: ref.purpose, refDigest: sha(row.blobRef) }
    inventory.set(model + ':' + row.id, record)
    if (model === 'fileAsset') {
      if (!hash.safeParse(row.sha256).success || !uint.safeParse(row.size).success
        || row.size > recoveryContentLimit(ref.purpose)) fail()
      const previous = witnesses.get(row.blobRef)
      if (previous && (previous.sha256 !== row.sha256 || previous.size !== row.size || previous.mime !== row.mime)) fail()
      witnesses.set(row.blobRef, row)
    }
  }
  for (const record of inventory.values()) {
    const witness = witnesses.get(record.row.blobRef)
    if (!witness || witness.size !== record.row.size || witness.mime !== record.row.mime) fail()
    record.witness = witness
  }
  return inventory
}

function validate({ manifest, snapshotBytes, objects }, profile) {
  const limits = profileSchema.parse(profile), data = manifestSchema.parse(manifest)
  snapshotBytes = bytesFor(snapshotBytes)
  if (canonicalBytes(data).length > limits.maxManifestBytes || snapshotBytes.length > limits.maxSnapshotBytes
    || data.entryCount !== data.entries.length || data.entryCount > limits.maxEntries
    || data.totalOriginalBytes > limits.maxOriginalBytes || sha(snapshotBytes) !== data.snapshotSha256
    || !(objects instanceof Map) || objects.size !== data.entryCount) fail()
  const snapshot = canonicalRead(snapshotBytes, limits.maxSnapshotBytes), inventory = reservedInventory(snapshot)
  const seen = new Set(), refs = new Set()
  let total = 0, count = 0, previousId = ''
  for (const entry of data.entries) {
    if (entry.objectId <= previousId || !objects.has(entry.objectId)
      || entry.byteLength > recoveryContentLimit(entry.purpose)) fail()
    previousId = entry.objectId
    const bytes = bytesFor(objects.get(entry.objectId))
    if (bytes.length !== entry.byteLength || sha(bytes) !== entry.sha256) fail()
    total += entry.byteLength; count += entry.bindings.length
    if (!Number.isSafeInteger(total) || total > limits.maxOriginalBytes || count > limits.maxBindings) fail()
    let previousBinding = '', entryRef = null
    for (const binding of entry.bindings) {
      const key = binding.model + ':' + binding.id, item = inventory.get(key)
      if (key <= previousBinding || seen.has(key) || !item || item.tenantId !== binding.tenantId
        || item.businessId !== binding.businessId || item.purpose !== entry.purpose
        || item.refDigest !== binding.sourceRefSha256 || sha(canonicalBytes(item.row)) !== binding.sourceRowSha256
        || item.witness.sha256 !== entry.sha256 || item.witness.size !== entry.byteLength
        || entryRef !== null && entryRef !== item.row.blobRef) fail()
      previousBinding = key; seen.add(key); entryRef = item.row.blobRef
    }
    if (refs.has(entryRef)) fail()
    refs.add(entryRef)
  }
  if (seen.size !== inventory.size || total !== data.totalOriginalBytes) fail()
  return { manifest: data, snapshot, snapshotBytes, objects, limits }
}

export function encodeManagedBlobTransfer(input, profile) {
  try {
    const value = validate(input, profile)
    const parts = [['transfer.json', canonicalBytes(value.manifest)], ['snapshot.json', value.snapshotBytes],
      ...value.manifest.entries.map(entry => [`obj_${entry.objectId}.bin`, bytesFor(value.objects.get(entry.objectId))])]
    let length = 1024
    for (const [, bytes] of parts) {
      length += 512 + Math.ceil(bytes.length / 512) * 512
      if (!Number.isSafeInteger(length) || length > value.limits.maxPackageBytes) fail()
    }
    const buffers = []
    for (const [name, bytes] of parts) buffers.push(header(name, bytes.length), bytes, Buffer.alloc((512 - bytes.length % 512) % 512))
    return Buffer.concat([...buffers, Buffer.alloc(1024)], length)
  } catch { fail() }
}

export function decodeManagedBlobTransfer(input, profile) {
  try {
    const limits = profileSchema.parse(profile), bytes = bytesFor(input)
    if (bytes.length > limits.maxPackageBytes || bytes.length % 512 !== 0) fail()
    let offset = 0
    const read = (name, limit) => {
      if (offset + 512 > bytes.length) fail()
      const block = bytes.subarray(offset, offset + 512)
      const sizeText = block.subarray(124, 136).toString('ascii')
      if (!/^[0-7]{11}\x00$/.test(sizeText)) fail()
      const size = parseInt(sizeText, 8), padded = Math.ceil(size / 512) * 512
      if (size > limit || !block.equals(header(name, size)) || offset + 512 + padded > bytes.length) fail()
      offset += 512
      const body = bytes.subarray(offset, offset + size)
      if (bytes.subarray(offset + size, offset + padded).some(byte => byte !== 0)) fail()
      offset += padded
      return body
    }
    const manifest = manifestSchema.parse(canonicalRead(read('transfer.json', limits.maxManifestBytes), limits.maxManifestBytes))
    if (manifest.entryCount !== manifest.entries.length || manifest.entryCount > limits.maxEntries
      || manifest.totalOriginalBytes > limits.maxOriginalBytes) fail()
    const snapshotBytes = read('snapshot.json', limits.maxSnapshotBytes), objects = new Map()
    for (const entry of manifest.entries) objects.set(entry.objectId, read(`obj_${entry.objectId}.bin`, entry.byteLength))
    if (bytes.length - offset !== 1024 || bytes.subarray(offset).some(byte => byte !== 0)) fail()
    const value = validate({ manifest, snapshotBytes, objects }, profile)
    // Freeze parsed evidence and own byte copies. Buffers/Map remain byte data,
    // not durable receipts: a future orchestrator must rehash sealed bytes and
    // revalidate all bindings before provider IO and the fenced metadata commit.
    return Object.freeze({ manifest: freezeJSON(value.manifest), snapshot: freezeJSON(value.snapshot), snapshotBytes: Buffer.from(snapshotBytes),
      objects: new Map([...objects].map(([id, body]) => [id, Buffer.from(body)])), packageSha256: sha(bytes) })
  } catch { fail() }
}
