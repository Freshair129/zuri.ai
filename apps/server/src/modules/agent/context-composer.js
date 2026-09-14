import { randomUUID } from 'node:crypto'
import { canonicalJson, sha256 } from './execution-trace'
import { CONTEXT_SLICE_SOURCES, CONTEXT_DENIAL_REASONS } from '@/lib/validation/enums'

// @req FR-234 — one agent-lane module (not a service) that assembles every model
// prompt of a LINE turn from the server-built AuthContext, MSP packet slices with
// provenance, knowledge evidence with citation ids, CRM/ERP operational facts and
// the account's policy.
// @spec ADR-091 D7, SDD-100 — authorization is checked first and a denial yields
// an empty packet, never a partial one; CRM/ERP record outranks GKS evidence,
// which outranks MSP memory; memory that contradicts a record is dropped with
// reason SUPERSEDED_BY_RECORD; one prompt-wide budget trims by priority and
// reports every trim; a group thread's slices never cross into another thread;
// with no evidence and no facts the caller places no model call.
//
// The `ContextReceipt` this module returns carries references, a hash and the
// budget — never slice content — matching the shape SDD-100 declares:
// `{ receiptId, refs: { msp, citations, records }, hash, budget: { max, used, trimmed }, dropped }`.
// The receipt describes only what is INCLUDED — the caller is required to build
// whatever it hands to a model from `composeContext(...).slices` (which DO carry
// content, returned separately from the receipt) so the two can never disagree:
// a slice this module dropped must never reach a model, and a slice a model
// received must always be named in the receipt that documents that call.
// @tested tests/unit/context-composer.test.js, tests/integration/line-worker-memory.test.js
//
// Scope for this phase (ADR-091 phase 3b): a pure, side-effect-free function.
// It never calls MSP, GKS, CRM/ERP or a model — callers pass already-fetched
// slices through the ports those lanes own. FR-235 (GKS grounding) and FR-231
// (memory projection policy) are separate, later phases; this module only
// accepts their shapes as inputs (`knowledgeEvidence`, and MSP slices through
// whatever thread-memory port is wired today).
//
// KNOWN COVERAGE GAP (left open by review, see the calling module's own
// annotation): only server-line-answer.js's MSP-opt-in branch calls this
// composer today. The LOCAL_ONLY / non-opt-in path's business-evidence model
// invocation (grounded-business-answer.js) does not yet run through it, so
// that invocation records no ContextReceipt. FR-234 declares "every model
// invocation of a LINE turn"; today's coverage is partial, not complete.

export const DEFAULT_CONTEXT_BUDGET_CHARS = 4000

// Derived from the canonical vocabulary (src/lib/validation/enums.js), never
// retyped: CONTEXT_SLICE_SOURCES is declared ['RECORD', 'KNOWLEDGE', 'MSP'],
// lowest index first, which doubles as the precedence order this module
// enforces — CRM/ERP record > GKS knowledge evidence > MSP memory.
const [SOURCE_RECORD, SOURCE_KNOWLEDGE, SOURCE_MSP] = CONTEXT_SLICE_SOURCES
const SOURCE_PRIORITY = Object.freeze(
  Object.fromEntries(CONTEXT_SLICE_SOURCES.map((source, priority) => [source, priority])),
)
const [DEFAULT_DENIAL_REASON] = CONTEXT_DENIAL_REASONS

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
  const content = isObject ? raw.text ?? raw.body ?? null : raw
  return {
    id,
    source,
    priority: SOURCE_PRIORITY[source],
    // Scopes this slice to one MSP thread; a group turn's slice from another
    // thread — or one carrying no thread at all once a thread is in scope — is
    // dropped rather than silently reused (ADR-091 D7 "Scope"; fail closed).
    threadId: isObject && typeof raw.threadId === 'string' ? raw.threadId : null,
    // 'PASSPORT' / 'CROSS_THREAD' mark durable-memory slices a non-DIRECT
    // audience must never receive (ADR-091 D4).
    scope: isObject && typeof raw.scope === 'string' ? raw.scope : null,
    citationId: isObject && typeof raw.citationId === 'string' ? raw.citationId : null,
    // Caller-supplied correlation key used only to detect a record/memory
    // conflict on the same subject (see composeContext doc comment below).
    subjectKey: isObject && typeof raw.subjectKey === 'string' ? raw.subjectKey : null,
    // Optional contiguity group for the budget cutoff (e.g. 'exchanges') — see
    // composeContext's doc comment on `mspSlices` for what this controls.
    sequence: isObject && typeof raw.sequence === 'string' ? raw.sequence : null,
    // The actual content a model would see. Carried on the slice — which this
    // module returns to the caller separately from the receipt — never on the
    // receipt itself.
    content,
    length: textLength(content),
  }
}

function buildReceipt({ refs, budget, dropped }) {
  const base = { refs, budget, dropped }
  return Object.freeze({ receiptId: `ctxrcpt_${randomUUID()}`, ...base, hash: sha256(base) })
}

function emptyRefs() {
  return { msp: [], citations: [], records: [] }
}

function authorizationRequired() {
  return Object.assign(new Error('CONTEXT_COMPOSER_AUTHORIZED_REQUIRED'),
    { code: 'CONTEXT_COMPOSER_AUTHORIZED_REQUIRED' })
}

/**
 * Pure composition of one model prompt's context. Never calls a port; every
 * input is already resolved evidence/facts/slices. Returns the slices actually
 * included — WITH their content, for the caller to assemble the model input
 * from — plus one content-free `ContextReceipt` describing exactly that same
 * selection. A caller must build what it sends to a model from `.slices` only;
 * building it from the original, un-composed input defeats every rule below.
 *
 * `records` (CRM/ERP operational facts) and `knowledgeEvidence` (GKS, with a
 * `citationId`) may declare a `subjectKey`; an MSP slice sharing that same
 * `subjectKey` is treated as describing the same subject as the record and is
 * dropped with `SUPERSEDED_BY_RECORD` — the exact matching key is this module's
 * own convention (ADR-091 D7 names the precedence rule, not a matching
 * algorithm) and every caller populating `subjectKey` opts into it.
 *
 * @param {object} input
 * @param {boolean} input.authorized — the resolved authorization decision for
 *   this turn's private/contextual access. Required and must be a literal
 *   `true`/`false`: a caller that forgot to resolve authorization must fail
 *   loudly, never silently receive a full packet. `false` yields an empty
 *   packet, never a partial one.
 * @param {string} [input.denialReason] — defaults to the canonical
 *   CONTEXT_DENIAL_REASONS[0] (src/lib/validation/enums.js).
 * @param {{threadId?: string}} [input.scope] — the current turn's thread, for
 *   group-thread isolation.
 * @param {string|null} [input.audienceKind] — 'DIRECT' | 'GROUP' | 'ROOM'.
 * @param {Array<object|string>} [input.records] — CRM/ERP operational facts.
 * @param {Array<object|string>} [input.knowledgeEvidence] — GKS evidence, each
 *   ideally carrying a `citationId`.
 * @param {Array<object|string>} [input.mspSlices] — MSP memory packet slices,
 *   split by the caller into provenance-bearing pieces (e.g. one per exchange
 *   or packet section) — never handed in as one opaque blob, or the budget can
 *   only ever keep or drop the whole thing. A slice may declare a `sequence`
 *   name (e.g. `'exchanges'`) to opt into a CONTIGUOUS cutoff within that named
 *   group only: once one slice in a given sequence does not fit, every later
 *   slice sharing that same sequence name is dropped too, even a smaller one
 *   that would fit alone — this is what keeps a "most recent window" free of
 *   gaps. A slice with no `sequence` is evaluated on its own: if it does not
 *   fit, only it is dropped, and the loop keeps evaluating everything after it
 *   — one oversized fact must never starve every slice that follows it, in its
 *   own sequence or any other. A caller that wants "keep the most recent, drop
 *   the oldest" for a sequence (e.g. MSP exchanges) must order that sequence's
 *   slices newest-first; sequencing is independent of source/priority order.
 * @param {number} [input.maxBudgetChars] — one prompt-wide character budget.
 */
export function composeContext({
  authorized,
  denialReason = DEFAULT_DENIAL_REASON,
  scope = {},
  audienceKind = null,
  records = [],
  knowledgeEvidence = [],
  mspSlices = [],
  maxBudgetChars = DEFAULT_CONTEXT_BUDGET_CHARS,
} = {}) {
  if (typeof authorized !== 'boolean') throw authorizationRequired()
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
    // Fail CLOSED: once a thread is in scope, a slice with no threadId at all
    // is exactly as untrusted as one naming a different thread. The earlier
    // version only dropped an explicit mismatch, so an MSP slice missing
    // provenance passed straight through to every audience.
    if (threadId && slice.threadId !== threadId) {
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
  // sort keeps each source's own relative (caller-supplied) ordering — for MSP
  // slices that is the order the caller split them in, so a caller that wants
  // recent exchanges kept ahead of older summaries orders them that way.
  const ordered = [...recordSlices, ...knowledgeSlices, ...scopedMsp]
    .map((slice, index) => ({ slice, index }))
    .sort((a, b) => (a.slice.priority - b.slice.priority) || (a.index - b.index))
    .map(({ slice }) => slice)

  // Contiguity is scoped to a named `sequence`, never to the whole prompt.
  // Within one sequence this is a strict cutoff, not first-fit: the first
  // slice in that sequence that does not fit closes it for every later slice
  // sharing that name, even a smaller one that would individually still fit
  // — first-fit would let a later, smaller slice fill the gap a bigger
  // dropped one left behind, turning "drop the oldest exchange" into "drop
  // whichever ones happen not to fit" and opening a hole mid-conversation.
  // A slice with no `sequence` is judged only on its own fit: if it does not
  // fit, only it is dropped and the loop moves on — one oversized record or
  // participant must never close the budget for every slice after it,
  // including an entire other sequence (e.g. the exchanges that follow it in
  // priority order). This is what regressed when the cutoff was briefly
  // global: a single large protected-memory record or participant, or (once
  // FR-235 wires GKS evidence) one large knowledge slice, would starve every
  // exchange after it even though they would have fit.
  let used = 0
  const exceededSequences = new Set()
  const included = []
  for (const slice of ordered) {
    if (slice.sequence && exceededSequences.has(slice.sequence)) {
      dropped.push({ id: slice.id, source: slice.source, reason: 'BUDGET_TRIMMED' })
      continue
    }
    if (used + slice.length <= maxBudgetChars) {
      used += slice.length
      included.push(slice)
    } else {
      dropped.push({ id: slice.id, source: slice.source, reason: 'BUDGET_TRIMMED' })
      if (slice.sequence) exceededSequences.add(slice.sequence)
    }
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
    // Included slices, WITH content — the caller assembles its model input
    // from these and nothing else, so it can never inject more than the
    // receipt (built from the very same list) documents.
    slices: Object.freeze(included.map((slice) => Object.freeze({ ...slice }))),
    dropped: Object.freeze(dtoDropped),
    hasEvidence,
    hasFacts,
    shouldCallModel: hasEvidence || hasFacts,
    receipt,
  })
}

export { CONTEXT_SLICE_SOURCES }
