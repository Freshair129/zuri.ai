import { canonicalJson, sha256, MAX_TRACE_PAYLOAD_BYTES } from './execution-trace'

// @req FR-171 — preserve API-009 entity revisions beside the exact recalled body.
// @spec ADR-070, ADR-022 — MSP owns entity versions; local hashes are content evidence only.
// @tested tests/unit/msp-memory-evidence.test.js

const MAX_ENTRIES = 256
const HASH = /^[a-f0-9]{64}$/i

function fail(code) {
  throw Object.assign(new Error(code), { code })
}

function text(value) {
  if (value == null) return null
  if (typeof value !== 'string' || !value.trim() || value.length > 512) fail('MSP_MEMORY_EVIDENCE_INVALID')
  return value
}

function timestamp(value) {
  if (value == null) return null
  const source = text(value)
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(source) || !Number.isFinite(Date.parse(source))) fail('MSP_MEMORY_EVIDENCE_INVALID')
  return new Date(source).toISOString()
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function capture(value) {
  let json
  try { json = canonicalJson(value) } catch { fail('MSP_MEMORY_EVIDENCE_INVALID') }
  if (Buffer.byteLength(json, 'utf8') > MAX_TRACE_PAYLOAD_BYTES) fail('MSP_MEMORY_EVIDENCE_TOO_LARGE')
  return JSON.parse(json)
}

function entityEvidence(node, vaultId, index) {
  const entity = node?.entity ?? node
  const hasBody = entity && typeof entity === 'object' && Object.hasOwn(entity, 'body_json')
  const body = hasBody ? entity.body_json : entity
  const memoryId = hasBody ? text(entity.entity_id) : null
  // An incomplete entity must not bypass an explicit conflicting scope claim.
  const sourceVaultId = entity && typeof entity === 'object' ? text(entity.vault_id) : null
  if (sourceVaultId && sourceVaultId !== vaultId) fail('MSP_MEMORY_EVIDENCE_SCOPE_MISMATCH')
  const version = hasBody ? entity.current_version ?? null : null
  if (version !== null && (!Number.isSafeInteger(version) || version < 1)) fail('MSP_MEMORY_EVIDENCE_INVALID')
  const sourceHash = hasBody ? text(entity.source_hash) : null
  if (sourceHash && !HASH.test(sourceHash)) fail('MSP_MEMORY_EVIDENCE_INVALID')
  const reasons = []
  if (!memoryId) reasons.push('MEMORY_ID_NOT_REPORTED')
  if (version === null) reasons.push('MEMORY_VERSION_NOT_REPORTED')
  if (!sourceVaultId) reasons.push('SOURCE_VAULT_NOT_REPORTED')
  if (!sourceHash) reasons.push('SOURCE_HASH_NOT_REPORTED')
  return {
    body,
    reference: {
      entryIndex: index, memoryId, version, sourceVaultId,
      category: hasBody ? text(entity.category) : null,
      key: hasBody ? text(entity.key) : null,
      sourceHash,
      // Hash the canonical JSON representation even when the body is a string.
      snapshotHash: sha256(canonicalJson(body)),
      recordedAt: hasBody ? timestamp(entity.recorded_at) : null,
      status: reasons.length ? 'INCOMPLETE' : 'VERSIONED', reasons,
    },
  }
}

/** Capture only the returned page; never turn pagination into a claim of all memory. */
export function captureMspMemoryRead(result, { vaultId, callerContext = null, observedAt = new Date().toISOString() }) {
  if (!text(vaultId)) fail('MSP_MEMORY_EVIDENCE_INVALID')
  const response = capture(result?.structuredContent ?? result)
  const nodes = Array.isArray(response) ? response
    : response?.entities ?? response?.items ?? response?.memories ?? response?.records ?? response?.hits
  if (!Array.isArray(nodes)) fail('MSP_MEMORY_EVIDENCE_INVALID')
  if (nodes.length > MAX_ENTRIES) fail('MSP_MEMORY_EVIDENCE_TOO_LARGE')
  const selected = nodes.map((node, index) => entityEvidence(node, vaultId, index))
  const versions = new Map()
  for (const { reference } of selected) {
    if (!reference.memoryId || reference.version === null) continue
    const key = JSON.stringify([reference.memoryId, reference.version])
    const hashes = JSON.stringify([reference.snapshotHash, reference.sourceHash?.toLowerCase() ?? null])
    if (versions.has(key) && versions.get(key) !== hashes) fail('MSP_MEMORY_EVIDENCE_CONFLICT')
    versions.set(key, hashes)
  }
  const hasCursor = !Array.isArray(response) && Object.hasOwn(response, 'next_page_token')
  if (hasCursor && response.next_page_token !== null && typeof response.next_page_token !== 'string') fail('MSP_MEMORY_EVIDENCE_INVALID')
  return freeze({
    entries: selected.map(value => value.body),
    evidence: {
      schemaVersion: 'msp-memory-evidence.v1', source: 'MSP_API_009', vaultId,
      observedAt: timestamp(observedAt), callerContext: callerContext ? capture(callerContext) : null,
      sessionAuthority: 'NOT_ATTESTED_BY_API_009',
      selection: 'RETURNED_PAGE', hasMore: hasCursor ? Boolean(response.next_page_token) : null,
      references: selected.map(value => value.reference),
    },
  })
}

/** Preserve page-local provenance when explicit legacy scopes return multiple vaults. */
export function combineMspMemoryReads(snapshots) {
  if (snapshots.length === 1) return snapshots[0]
  const entries = snapshots.flatMap(snapshot => snapshot.entries)
  if (entries.length > MAX_ENTRIES) fail('MSP_MEMORY_EVIDENCE_TOO_LARGE')
  let entryOffset = 0
  const pages = snapshots.map(snapshot => {
    const page = { entryOffset, evidence: snapshot.evidence }
    entryOffset += snapshot.entries.length
    return page
  })
  return freeze(capture({ entries, evidence: {
    schemaVersion: 'msp-memory-evidence.v1', source: 'MSP_API_009',
    selection: 'RETURNED_PAGES', pages,
  } }))
}

/** The upsert response is evidence of that write, independent of the later list. */
export function captureMspMemoryWrite(result, { vaultId, expectedKey, expectedCategory, observedAt = new Date().toISOString() }) {
  try {
    if (!text(vaultId)) fail('MSP_MEMORY_EVIDENCE_INVALID')
    observedAt = timestamp(observedAt)
    if (!result?.entity && !result?.structuredContent?.entity) {
      return freeze({ status: 'UNAVAILABLE', reason: 'WRITE_ENTITY_NOT_REPORTED', observedAt })
    }
    const response = capture(result?.structuredContent ?? result)
    const selected = entityEvidence(response.entity, vaultId, 0)
    const reasons = []
    for (const [field, expected] of [['key', expectedKey], ['category', expectedCategory]]) {
      if (expected === undefined) continue
      if (selected.reference[field] === null) reasons.push(`WRITE_${field.toUpperCase()}_NOT_REPORTED`)
      else if (selected.reference[field] !== expected) fail('MSP_MEMORY_WRITE_TARGET_MISMATCH')
    }
    return freeze({
      status: selected.reference.status === 'VERSIONED' && reasons.length === 0 ? 'ACKNOWLEDGED' : 'INCOMPLETE',
      reasons,
      observedAt, entry: selected.body, reference: selected.reference,
      created: typeof response.created === 'boolean' ? response.created : null,
      changed: typeof response.changed === 'boolean' ? response.changed : null,
    })
  } catch (error) {
    // The remote write already happened. Never present a validation failure as
    // permission to retry an effect whose final outcome is now uncertain.
    error.writeOutcome = 'UNKNOWN'
    throw error
  }
}
