import { queryKnowledge, createGraphKnowledgeReader } from '@/modules/knowledge'
import { createInMemoryMemory } from './memory-port'
import { createMspMemoryPort } from './msp-memory-port'
import { createMspVaultResolver } from './msp-vault-resolver'
import { createMspThreadMemoryPort } from './msp-thread-memory-port'
import { sha256 } from './execution-trace'

// @req FR-029 — bind the agent to the REAL backends: MSP memory + GenesisBlockDB
//   knowledge, as the ports assembleAgentContext/handleAgentTurn consume.
// @spec ADR-007 §P6 — the agent consumes settled contracts (Identity + MSP + GKS +
//   Tools); each is a separate authority/store (not bundled as in GoVibe), wired here.
//   Graceful fallback: an unconfigured backend degrades to the in-memory / Prisma
//   default so the same turn runs in tests, demo, and production.
// @tested tests/integration/agent-runtime.test.js
// @tested tests/unit/agent-runtime-lineage.test.js

const MEMORY_LINEAGE_SCHEMA_VERSION = 'agent-memory-lineage.v1'
const MEMORY_REFERENCE_FIELDS = Object.freeze([
  'memoryId', 'version', 'sourceVaultId', 'key', 'category', 'sourceHash', 'snapshotHash',
])
const HASH = /^[a-f0-9]{64}$/i

function freezeDeep(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) freezeDeep(child, seen)
  return Object.freeze(value)
}

function lineageError(code, message, details = {}) {
  return Object.assign(new Error(`${code}: ${message}`), { code, status: 409, details })
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeMemoryReference(reference, index) {
  const value = reference && typeof reference === 'object' ? reference : {}
  const normalized = {
    memoryId: textOrNull(value.memoryId),
    version: Number.isSafeInteger(value.version) && value.version > 0 ? value.version : null,
    sourceVaultId: textOrNull(value.sourceVaultId),
    key: textOrNull(value.key),
    category: textOrNull(value.category),
    sourceHash: value.sourceHash == null ? null : textOrNull(value.sourceHash)?.toLowerCase() ?? null,
    snapshotHash: textOrNull(value.snapshotHash)?.toLowerCase() ?? null,
  }
  const reasons = []
  if (!normalized.memoryId) reasons.push(`MEMORY_REFERENCE_${index}_ID_MISSING`)
  if (normalized.version === null) reasons.push(`MEMORY_REFERENCE_${index}_VERSION_MISSING`)
  if (!normalized.snapshotHash || !HASH.test(normalized.snapshotHash)) {
    reasons.push(`MEMORY_REFERENCE_${index}_SNAPSHOT_HASH_INVALID`)
  }
  if (normalized.sourceHash !== null && !HASH.test(normalized.sourceHash)) {
    reasons.push(`MEMORY_REFERENCE_${index}_SOURCE_HASH_INVALID`)
    normalized.sourceHash = null
  }
  return { normalized, reasons }
}

function buildMemoryLineage(context) {
  const memory = context?.memory
  const entries = memory?.entries
  if (entries !== undefined && !Array.isArray(entries)) {
    throw lineageError('AGENT_MEMORY_LINEAGE_INVALID', 'memory entries must be an array when present')
  }

  const evidence = memory?.evidence
  const reasons = []
  if (evidence == null) {
    if (entries?.length) reasons.push('MEMORY_EVIDENCE_MISSING')
    const empty = { schemaVersion: MEMORY_LINEAGE_SCHEMA_VERSION, vaultId: null, references: [], complete: reasons.length === 0, reasons }
    return freezeDeep({ ...empty, hash: sha256({ schemaVersion: empty.schemaVersion, vaultId: empty.vaultId, references: empty.references }) })
  }
  if (typeof evidence !== 'object' || Array.isArray(evidence) || !Array.isArray(evidence.references)) {
    throw lineageError('AGENT_MEMORY_LINEAGE_INVALID', 'memory evidence must expose a references array')
  }

  const vaultId = evidence.vaultId == null ? null : textOrNull(evidence.vaultId)
  if (evidence.vaultId != null && !vaultId) reasons.push('MEMORY_VAULT_ID_INVALID')
  if (entries && entries.length !== evidence.references.length) reasons.push('MEMORY_REFERENCE_COUNT_MISMATCH')

  const references = evidence.references.map((reference, index) => {
    const { normalized, reasons: referenceReasons } = normalizeMemoryReference(reference, index)
    reasons.push(...referenceReasons)
    if (entries && entries[index] !== undefined && normalized.snapshotHash) {
      try {
        if (sha256(entries[index]) !== normalized.snapshotHash) reasons.push(`MEMORY_REFERENCE_${index}_SNAPSHOT_HASH_MISMATCH`)
      } catch {
        reasons.push(`MEMORY_REFERENCE_${index}_ENTRY_INVALID`)
      }
    }
    return normalized
  })
  const fingerprint = { schemaVersion: MEMORY_LINEAGE_SCHEMA_VERSION, vaultId, references }
  return freezeDeep({ ...fingerprint, complete: reasons.length === 0, reasons, hash: sha256(fingerprint) })
}

/**
 * Capture only stable MSP memory identity/version evidence from an assembled context.
 * The result contains no memory body and is safe to persist beside a replay record.
 * Missing evidence is retained as an explicit incomplete state; it is never filled
 * from the current memory port.
 */
export function captureAgentMemoryLineage(context) {
  return buildMemoryLineage(context)
}

function displayLineageValue(value) {
  return value == null ? 'missing' : String(value)
}

function compareMemoryLineage(recorded, current) {
  const divergences = []
  if (recorded.vaultId !== current.vaultId) {
    divergences.push({ field: 'vaultId', recorded: recorded.vaultId, current: current.vaultId, reason: 'MEMORY_VAULT_DIVERGED' })
  }
  if (recorded.references.length !== current.references.length) {
    divergences.push({ field: 'referenceCount', recorded: recorded.references.length, current: current.references.length, reason: 'MEMORY_REFERENCE_COUNT_DIVERGED' })
  }
  const length = Math.max(recorded.references.length, current.references.length)
  for (let index = 0; index < length; index += 1) {
    const expected = recorded.references[index]
    const actual = current.references[index]
    if (!expected || !actual) {
      divergences.push({ index, field: 'reference', memoryId: expected?.memoryId ?? actual?.memoryId ?? null,
        recorded: expected ?? null, current: actual ?? null, reason: 'MEMORY_REFERENCE_DIVERGED' })
      continue
    }
    for (const field of MEMORY_REFERENCE_FIELDS) {
      if (expected[field] === actual[field]) continue
      const reason = field === 'version'
        ? 'MEMORY_VERSION_DIVERGED'
        : field === 'snapshotHash'
          ? 'MEMORY_CONTENT_DIVERGED'
          : 'MEMORY_REFERENCE_DIVERGED'
      divergences.push({ index, field, memoryId: expected.memoryId ?? actual.memoryId ?? null,
        recorded: expected[field], current: actual[field], reason })
    }
  }
  return divergences
}

/**
 * Validate a replay context against the recorded memory lineage before it is used.
 * This is deliberately pure: it never calls MSP, a model, a tool, or a provider.
 * A current context with a newer or otherwise different memory reference is refused
 * with the recorded/current version details instead of being silently substituted.
 */
export function replayAgentContext({ recordedContext, currentContext } = {}) {
  const recordedLineage = captureAgentMemoryLineage(recordedContext)
  const currentLineage = captureAgentMemoryLineage(currentContext)
  const unavailable = [
    ...(recordedLineage.complete ? [] : recordedLineage.reasons.map(reason => ({ side: 'recorded', reason }))),
    ...(currentLineage.complete ? [] : currentLineage.reasons.map(reason => ({ side: 'current', reason }))),
  ]
  if (unavailable.length) {
    throw lineageError(
      'AGENT_REPLAY_LINEAGE_UNAVAILABLE',
      `replay refused because memory lineage is incomplete (${unavailable.map(item => `${item.side}:${item.reason}`).join(', ')})`,
      { recordedLineage, currentLineage, unavailable },
    )
  }
  const divergences = compareMemoryLineage(recordedLineage, currentLineage)
  if (divergences.length) {
    const first = divergences[0]
    const subject = first.memoryId ? `memory ${first.memoryId}` : `memory entry ${first.index ?? 'unknown'}`
    const message = first.field === 'version'
      ? `${subject} version diverged (recorded ${displayLineageValue(first.recorded)}; replay ${displayLineageValue(first.current)})`
      : `${subject} ${first.field} diverged (recorded ${displayLineageValue(first.recorded)}; replay ${displayLineageValue(first.current)})`
    throw lineageError('AGENT_REPLAY_LINEAGE_DIVERGED', `replay refused: ${message}`, {
      recordedLineage, currentLineage, divergences,
    })
  }
  return Object.freeze({ replayed: true, context: currentContext, recordedLineage, currentLineage })
}

/**
 * Compose the agent's runtime ports from whatever real backends are configured.
 * - MSP memory when an `mspTransport` is given, else the in-memory port.
 * - GenesisBlockDB knowledge when a `graphTraverse` is given, else the Prisma read.
 * MSP and GKS stay independent — configuring one never requires the other.
 *
 * @param {Object} [backends]
 * @param {Function} [backends.mspTransport]   injected MSP tool-caller (name,input)=>result
 * @param {Function} [backends.graphTraverse]  injected graph read ({tenantId,principalId})=>relations[]
 * @param {{resolve: Function}|Function} [backends.mspVaultResolver] canonical API-010 resolver
 * @param {boolean} [backends.mspCompatibilityMode] explicitly enable legacy scopeKey mode
 * @returns {{ memory: import('./memory-port').MemoryPort, knowledge: Function, threadMemory: object|null, replayAgentContext: Function }}
 */
export function createAgentPorts({ mspTransport, mspVaultResolver, mspCompatibilityMode = false, mspActor = 'zuri-agent', graphTraverse } = {}) {
  const memory = mspTransport
    ? mspCompatibilityMode
      ? createMspMemoryPort({ transport: mspTransport, vaultResolver: mspVaultResolver, compatibilityMode: true })
      : createMspMemoryPort({
          transport: mspTransport,
          vaultSetResolver: mspVaultResolver ?? createMspVaultResolver({ transport: mspTransport, actor: mspActor }),
        })
    : createInMemoryMemory()
  const knowledge = graphTraverse ? createGraphKnowledgeReader({ traverse: graphTraverse }) : queryKnowledge
  const threadMemory = mspTransport
    ? createMspThreadMemoryPort({ transport: mspTransport, actor: mspActor })
    : null
  return { memory, knowledge, threadMemory, replayAgentContext }
}
