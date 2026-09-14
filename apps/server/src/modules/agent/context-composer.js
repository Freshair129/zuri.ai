import { randomUUID } from 'node:crypto'
import { canonicalJson, sha256 } from './execution-trace'
import { CONTEXT_SLICE_SOURCES } from '@/lib/validation/enums'

// @req FR-234 — one agent-lane module (not a service) that assembles every model
// prompt of a LINE turn from the server-built AuthContext, MSP packet slices with
// provenance, knowledge evidence with citation ids, CRM/ERP operational facts and
// the account's policy.
// @spec ADR-091 D7, SDD-100 — authorization is checked first and a denial yields
// an empty packet, never a partial one; CRM/ERP record outranks GKS evidence,
// which outranks MSP memory; memory that contradicts a record is dropped with
// reason SUPERSEDED_BY_RECORD; one prompt-wide budget trims by priority and
// reports every trim; a group thread's slices never cross into another thread;
// with no evidence and no facts the caller places no model call. The receipt
// this module returns carries references, a hash and the budget — never content
// — matching the shape SDD-100 declares:
// `{ receiptId, refs: { msp, citations, records }, hash, budget: { max, used, trimmed }, dropped }`.
// @tested tests/unit/context-composer.test.js, tests/integration/line-worker-memory.test.js
//
// Scope for this phase (ADR-091 phase 3b): a pure, side-effect-free function.
// It never calls MSP, GKS, CRM/ERP or a model — callers pass already-fetched
// slices through the ports those lanes own. FR-235 (GKS grounding) and FR-231
// (memory projection policy) are separate, later phases; this module only
// accepts their shapes as inputs (`knowledgeEvidence`, and MSP slices through
// whatever thread-memory port is wired today).

export const DEFAULT_CONTEXT_BUDGET_CHARS = 4000

// Derived from the canonical vocabulary (src/lib/validation/enums.js), never
// retyped: CONTEXT_SLICE_SOURCES is declared ['RECORD', 'KNOWLEDGE', 'MSP'],
// lowest index first, which doubles as the precedence order this module
// enforces — CRM/ERP record > GKS knowledge evidence > MSP memory.
const [SOURCE_RECORD, SOURCE_KNOWLEDGE, SOURCE_MSP] = CONTEXT_SLICE_SOURCES
const SOURCE_PRIORITY = Object.freeze(
  Object.fromEntries(CONTEXT_SLICE_SOURCES.map((source, priority) => [source, priority])),
)

function textLength(value) {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  try {
    return canonicalJson(value).length
  } catch {
    return String(value).length
  }
}

/** Accepts a plain object or string; never mutates the caller's slice. */
function normalizeSlice(raw, source, index) {
  if (raw == null) return null
  const isObject = typeof raw === 'object'
  const id = isObject && typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${source.toLowerCase()}:${index}`
  const text = isObject ? raw.text ?? raw.body ?? null : raw
  return {
    id,
    source,
    priority: SOURCE_PRIORITY[source],
    // Scopes this slice to one MSP thread; a group turn's slice from another
    // thread is dropped rather than silently reused (ADR-091 D7 "Scope").
    threadId: isObject && typeof raw.threadId === 'string' ? raw.threadId : null,
    // 'PASSPORT' / 'CROSS_THREAD' mark durable-memory slices a non-DIRECT
    // audience must never receive (ADR-091 D4).
    scope: isObject && typeof raw.scope === 'string' ? raw.scope : null,
    citationId: isObject && typeof raw.citationId === 'string' ? raw.citationId : null,
    // Caller-supplied correlation key used only to detect a record/memory
    // conflict on the same subject (see composeContext doc comment below).
    subjectKey: isObject && typeof raw.subjectKey === 'string' ? raw.subjectKey : null,
    length: textLength(text),
  }
}

function buildReceipt({ refs, budget, dropped }) {
  const base = { refs, budget, dropped }
  return Object.freeze({ receiptId: `ctxrcpt_${randomUUID()}`, ...base, hash: sha256(base) })
}

function emptyRefs() {
  return { msp: [], citations: [], records: [] }
}

/**
 * Pure composition of one model prompt's context. Never calls a port; every
 * input is already resolved evidence/facts/slices. Returns a bounded packet of
 * included slice references (never their content) plus one `ContextReceipt`.
 *
 * `records` (CRM/ERP operational facts) and `knowledgeEvidence` (GKS, with a
 * `citationId`) may declare a `subjectKey`; an MSP slice sharing that same
 * `subjectKey` is treated as describing the same subject as the record and is
 * dropped with `SUPERSEDED_BY_RECORD` — the exact matching key is this module's
 * own convention (ADR-091 D7 names the precedence rule, not a matching
 * algorithm) and every caller populating `subjectKey` opts into it.
 *
 * @param {object} input
 * @param {boolean} [input.authorized=true] — the resolved authorization decision
 *   for this turn's private/contextual access. `false` yields an empty packet.
 * @param {string} [input.denialReason='CONTEXT_DENIED']
 * @param {{threadId?: string}} [input.scope] — the current turn's thread, for
 *   group-thread isolation.
 * @param {string|null} [input.audienceKind] — 'DIRECT' | 'GROUP' | 'ROOM'.
 * @param {Array<object|string>} [input.records] — CRM/ERP operational facts.
 * @param {Array<object|string>} [input.knowledgeEvidence] — GKS evidence, each
 *   ideally carrying a `citationId`.
 * @param {Array<object|string>} [input.mspSlices] — MSP memory packet slices.
 * @param {number} [input.maxBudgetChars] — one prompt-wide character budget.
 */
export function composeContext({
  authorized = true,
  denialReason = 'CONTEXT_DENIED',
  scope = {},
  audienceKind = null,
  records = [],
  knowledgeEvidence = [],
  mspSlices = [],
  maxBudgetChars = DEFAULT_CONTEXT_BUDGET_CHARS,
} = {}) {
  if (!Number.isFinite(maxBudgetChars) || maxBudgetChars < 0) {
    throw Object.assign(new Error('CONTEXT_BUDGET_INVALID'), { code: 'CONTEXT_BUDGET_INVALID' })
  }

  // "No evidence and no facts" is read literally from ADR-091 D7: GKS knowledge
  // evidence and CRM/ERP records are what gate a model call. MSP memory alone —
  // in-thread continuity with nothing new to ground an answer in — does not.
  const hasEvidence = knowledgeEvidence.length > 0
  const hasFacts = records.length > 0

  if (!authorized) {
    return Object.freeze({
      authorized: false,
      denialReason,
      slices: Object.freeze([]),
      dropped: Object.freeze([]),
      hasEvidence: false,
      hasFacts: false,
      shouldCallModel: false,
      receipt: buildReceipt({ refs: emptyRefs(), budget: { max: maxBudgetChars, used: 0, trimmed: 0 }, dropped: [] }),
    })
  }

  const threadId = typeof scope?.threadId === 'string' && scope.threadId ? scope.threadId : null
  const recordSlices = records.map((item, index) => normalizeSlice(item, SOURCE_RECORD, index)).filter(Boolean)
  const knowledgeSlices = knowledgeEvidence.map((item, index) => normalizeSlice(item, SOURCE_KNOWLEDGE, index)).filter(Boolean)
  const mspSlicesRaw = mspSlices.map((item, index) => normalizeSlice(item, SOURCE_MSP, index)).filter(Boolean)

  const dropped = []
  const recordKeys = new Set(recordSlices.map((slice) => slice.subjectKey).filter(Boolean))
  const nonDirect = audienceKind != null && audienceKind !== 'DIRECT'

  const scopedMsp = []
  for (const slice of mspSlicesRaw) {
    if (threadId && slice.threadId && slice.threadId !== threadId) {
      dropped.push({ id: slice.id, source: slice.source, reason: 'THREAD_SCOPE_MISMATCH' })
      continue
    }
    if (nonDirect && (slice.scope === 'PASSPORT' || slice.scope === 'CROSS_THREAD')) {
      dropped.push({ id: slice.id, source: slice.source, reason: 'AUDIENCE_SCOPE_DENIED' })
      continue
    }
    if (slice.subjectKey && recordKeys.has(slice.subjectKey)) {
      dropped.push({ id: slice.id, source: slice.source, reason: 'SUPERSEDED_BY_RECORD' })
      continue
    }
    scopedMsp.push(slice)
  }

  // Priority order for the shared budget: record > knowledge > memory. A stable
  // sort keeps each source's own relative (caller-supplied) ordering.
  const ordered = [...recordSlices, ...knowledgeSlices, ...scopedMsp]
    .map((slice, index) => ({ slice, index }))
    .sort((a, b) => (a.slice.priority - b.slice.priority) || (a.index - b.index))
    .map(({ slice }) => slice)

  let used = 0
  const included = []
  for (const slice of ordered) {
    if (used + slice.length > maxBudgetChars) {
      dropped.push({ id: slice.id, source: slice.source, reason: 'BUDGET_TRIMMED' })
      continue
    }
    used += slice.length
    included.push(slice)
  }

  const trimmed = dropped.filter((entry) => entry.reason === 'BUDGET_TRIMMED').length
  const refs = {
    records: included.filter((slice) => slice.source === SOURCE_RECORD).map((slice) => slice.id),
    citations: included.filter((slice) => slice.source === SOURCE_KNOWLEDGE).map((slice) => slice.citationId ?? slice.id),
    msp: included.filter((slice) => slice.source === SOURCE_MSP).map((slice) => slice.id),
  }
  const dtoDropped = dropped.map(({ id, source, reason }) => ({ id, source, reason }))
  const receipt = buildReceipt({ refs, budget: { max: maxBudgetChars, used, trimmed }, dropped: dtoDropped })

  return Object.freeze({
    authorized: true,
    denialReason: null,
    slices: Object.freeze(included),
    dropped: Object.freeze(dtoDropped),
    hasEvidence,
    hasFacts,
    shouldCallModel: hasEvidence || hasFacts,
    receipt,
  })
}

export { CONTEXT_SLICE_SOURCES }
