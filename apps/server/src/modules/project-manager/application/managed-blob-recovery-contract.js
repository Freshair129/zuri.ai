// @req FR-292 — bounded matching evidence for exact original-byte recovery.
// @spec ADR-115
// @tested tests/unit/managed-blob-recovery-contract.test.js
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { parseBusinessObjectRef } from '@/platform/storage/private-business-object-storage'
import { ASSET_EVIDENCE_MAX_BYTES } from '@/modules/asset-management/domain/evidence-policy'
import { SMARTGIFT_CATALOG_MAX_FILE_BYTES } from '@/modules/knowledge/smartgift-catalog-adapter'

export const RECOVERY_DESCRIPTOR_MAX_BYTES = 64 * 1024
export const RECOVERY_CONTENT_MAX_BYTES = 32 * 1024 * 1024
const limits = Object.freeze({ asset: Math.min(RECOVERY_CONTENT_MAX_BYTES, ASSET_EVIDENCE_MAX_BYTES),
  catalog: Math.min(RECOVERY_CONTENT_MAX_BYTES, SMARTGIFT_CATALOG_MAX_FILE_BYTES) })
export const recoveryContentLimit = purpose => limits[purpose]
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const positive = z.number().int().positive().safe()
const descriptorSchema = z.object({ schemaVersion: z.literal(1), fileId: uuid,
  fileVersion: positive, tenantId: uuid, businessId: uuid, purpose: z.enum(['asset', 'catalog']),
  sourceRefSha256: sha256, sha256, byteLength: z.number().int().nonnegative().safe(),
}).strict().refine(value => value.byteLength <= limits[value.purpose])
const binding = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value =>
  Buffer.from(value, 'base64url').length === 32 && Buffer.from(value, 'base64url').toString('base64url') === value)
const requests = Object.freeze({
  prepare: z.object({ expectedVersion: positive }).strict(),
  stage: z.object({ confirmationBinding: binding, expectedOperationVersion: positive }).strict(),
  confirm: z.object({ confirmationBinding: binding, expectedOperationVersion: positive }).strict(),
  inspect: z.object({}).strict(),
  abandon: z.object({ expectedOperationVersion: positive }).strict(),
})

export function recoveryError(status = 400, code = 'MANAGED_BLOB_RECOVERY_INVALID') {
  return Object.assign(new Error('Recovery request refused'), { status, code })
}
export const recoverySha256 = value => createHash('sha256').update(value).digest('hex')

// JSON.parse is the syntax parser; this second bounded token walk rejects keys
// it would otherwise silently overwrite, including escaped aliases. No recursion
// or prototype-based key map is used. All diagnostics are intentionally generic.
export function readRecoveryJSON(input, maxBytes = RECOVERY_DESCRIPTOR_MAX_BYTES) {
  try {
    if (!(typeof input === 'string' || input instanceof Uint8Array)) throw recoveryError()
    if ((typeof input === 'string' ? Buffer.byteLength(input) : input.byteLength) > maxBytes) throw recoveryError(413)
    const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input)
    if (text.startsWith('\ufeff')) throw recoveryError()
    const value = JSON.parse(text)
    const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) || []
    const stack = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token === '{' || token === '[') {
        stack.push(token === '{' ? new Set() : null)
        if (stack.length > 24) throw recoveryError()
      } else if (token === '}' || token === ']') stack.pop()
      else if (token.startsWith('"') && tokens[i + 1] === ':') {
        const key = JSON.parse(token), keys = stack.at(-1)
        if (!keys || keys.has(key)) throw recoveryError()
        keys.add(key)
      }
    }
    return value
  } catch (error) { throw recoveryError(error?.status === 413 ? 413 : 400) }
}

function parseDescriptor(value) {
  const result = descriptorSchema.safeParse(value)
  if (!result.success) throw recoveryError()
  return Object.freeze(result.data)
}
export function parseRecoveryDescriptor(input) { return parseDescriptor(readRecoveryJSON(input)) }
export function parseRecoveryRequest(kind, input) {
  const result = Object.hasOwn(requests, kind) ? requests[kind].safeParse(input) : null
  if (!result?.success) throw recoveryError()
  return Object.freeze(result.data)
}

export function recoveryDescriptorForFile(file) {
  try {
    if (!file || file.storageKind !== 'MANAGED_BLOB' || file.status !== 'ACTIVE' || file.deletedAt != null) throw recoveryError()
    const ref = parseBusinessObjectRef(file.blobRef)
    const parts = ref.key.split('/')
    if (parts.length < 5 || parts[0] !== (ref.purpose === 'asset' ? 'asset-evidence' : 'business-catalog')
      || parts[1] !== file.tenantId || parts[2] !== file.businessId
      || parts.some(part => !part || part === '.' || part === '..' || /[\\?#\x00-\x1f\x7f]/.test(part))) throw recoveryError()
    return parseDescriptor({ schemaVersion: 1, fileId: file.id, fileVersion: file.version,
      tenantId: file.tenantId, businessId: file.businessId, purpose: ref.purpose,
      sourceRefSha256: recoverySha256(file.blobRef), sha256: file.sha256, byteLength: file.size })
  } catch { throw recoveryError() }
}

// Pure byte-budgeted streaming verifier: consumes no more than the expected
// length; does not retain bytes or grant staging/attachment authority. It does
// not own iterator/transport liveness: OR3 must supply the existing transport
// deadline and cancellation (including stalled/empty-chunk streams) before use.
// The durable spool/lease and live authority belong to the OR2 orchestrator.
export async function verifyRecoveryContent(descriptor, chunks, expected) {
  try {
    const value = parseDescriptor(descriptor), tuple = parseDescriptor(expected)
    if (Object.keys(tuple).some(key => tuple[key] !== value[key])) throw recoveryError(409)
    if (!chunks || typeof chunks === 'string'
      || !(chunks[Symbol.asyncIterator] || chunks[Symbol.iterator])) throw recoveryError()
    const hash = createHash('sha256')
    let byteLength = 0
    for await (const chunk of chunks) {
      if (!(chunk instanceof Uint8Array)) throw recoveryError()
      if (chunk.byteLength > tuple.byteLength - byteLength) throw recoveryError(413)
      byteLength += chunk.byteLength
      hash.update(chunk)
    }
    const digest = hash.digest('hex')
    if (byteLength !== tuple.byteLength || digest !== tuple.sha256) throw recoveryError()
    return Object.freeze({ sha256: digest, byteLength })
  } catch (error) { throw recoveryError([409, 410, 413].includes(error?.status) ? error.status : 400) }
}
