// @req FR-137 — Asset evidence is bounded, content-verified and hashed before storage.
// @spec SDD-081, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-storage-contract.test.js
import path from 'node:path'
import { createHash } from 'node:crypto'

export const ASSET_EVIDENCE_MAX_BYTES = 20 * 1024 * 1024

const SIGNATURES = [
  { mime: 'application/pdf', matches: (content) => content.subarray(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'image/jpeg', matches: (content) => content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff },
  { mime: 'image/png', matches: (content) => content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', matches: (content) => content.length >= 12 && content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP' },
]

const EXTENSIONS = Object.freeze({
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
})

function evidenceError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function asBuffer(content) {
  if (Buffer.isBuffer(content)) return content
  if (content instanceof Uint8Array || content instanceof ArrayBuffer) return Buffer.from(content)
  throw evidenceError('Evidence content must be bytes')
}

export function inspectAssetEvidence({ content, declaredMime, name }) {
  const bytes = asBuffer(content)
  if (!bytes.length) throw evidenceError('Evidence file is empty')
  if (bytes.length > ASSET_EVIDENCE_MAX_BYTES) throw evidenceError('Evidence exceeds the 20 MiB limit', 413)
  const detected = SIGNATURES.find((signature) => signature.matches(bytes))?.mime
  if (!detected) throw evidenceError('Unsupported evidence content type', 415)
  if (declaredMime !== detected) throw evidenceError(`Declared MIME ${declaredMime || '(missing)'} does not match detected ${detected}`, 415)
  if (typeof name !== 'string' || !name.trim()) throw evidenceError('Evidence filename is required')
  return {
    mime: detected,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    content: bytes,
  }
}

function safeSegment(value, fallback) {
  const normalized = String(value || '').normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

export function buildAssetEvidenceObjectKey({ tenantId, businessId, sha256, name }) {
  if (!/^[a-f0-9]{64}$/.test(sha256 || '')) throw evidenceError('A valid SHA-256 is required')
  const originalExt = path.extname(String(name || '')).toLowerCase()
  const stem = safeSegment(path.basename(String(name || ''), originalExt), 'evidence')
  const ext = Object.values(EXTENSIONS).includes(originalExt) ? originalExt : ''
  return [
    'asset-evidence',
    safeSegment(tenantId, 'tenant'),
    safeSegment(businessId, 'business'),
    sha256.slice(0, 2),
    `${sha256}-${stem}${ext}`,
  ].join('/')
}
