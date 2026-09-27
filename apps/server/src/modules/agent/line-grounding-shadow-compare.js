import prisma from '@/lib/db'
import { createCorpusKnowledgeReader } from '@/modules/knowledge'
import { answerBusinessQuestion } from './grounded-business-answer'
import { createLineGroundingReader, lineKnowledgeGroundingBudgetFromEnv } from './line-knowledge-grounding'

// @req FR-277 — the LINE grounding shadow-compare harness (ADR-090 Phase 3,
// TASK-ZAI-095). When a LINE OA account carries `knowledgeGroundingShadow:
// true`, a SERVER job's answer — already computed and about to be sent under
// the account's LIVE `knowledgeGrounding` mode — also triggers ONE best-effort,
// non-blocking generation under the PAIRED mode, so an operator can compare
// `BUSINESS_KNOWLEDGE` against `GKS_THEN_BUSINESS_KNOWLEDGE` for one campaign
// window before trusting a full switch (the switch/rollback runbook itself is
// a separate, sibling change; this module only produces the comparison data).
//
// Design constraints this module exists to satisfy:
//  - The customer NEVER sees the shadow answer. `runLineGroundingShadowCompare`
//    is called without being awaited by the customer-facing path
//    (`server-line-answer.js`) and its return value is discarded there — this
//    module itself also never mutates the job, the CRM record, MSP thread
//    memory or the job's own `AgentTraceEvent` journal. Its own grounding
//    hops are captured into a private array, not traced through the real
//    `trace` a caller may pass elsewhere.
//  - Disabled by default: every helper here is a no-op unless
//    `job.account.knowledgeGroundingShadow === true` AND the account's live
//    mode has a defined shadow partner (`otherGroundingMode`).
//  - Never doubles the CRITICAL PATH's latency: this function is written to
//    be started (not awaited) once the primary answer is already known, and
//    every internal step is time-budgeted so a hung provider or a hung GKS
//    hop cannot leak an unbounded background task.
//  - Never throws to its caller. Every failure — building the reader,
//    generating, timing out, or writing the comparison row itself — is
//    caught; the worst case is simply no comparison row for that job.
// @spec ADR-090 D1-D3 — the paired-mode reader reuses the exact same
//   `createLineGroundingReader`/`createCorpusKnowledgeReader` wiring and
//   budget the primary answer uses, so a comparison is apples-to-apples.
// @spec SEC-032 — the comparison row carries the same answer text the primary
//   path already sends the customer (no new customer content), plus evidence
//   source/reason, retrieval references, latency and outcome only.
// @tested tests/unit/line-grounding-shadow-compare.test.js,
//   tests/integration/fr277-line-grounding-shadow-compare.test.js

export const LINE_GROUNDING_SHADOW_DEFAULT_TIMEOUT_MS = 8000
const ANSWER_TEXT_MAX_CHARS = 4000

function positiveIntFromEnv(env, key, fallback) {
  const raw = env?.[key]
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Configuration is read from the environment, never hard-coded (SDD-099), matching line-knowledge-grounding.js. */
export function lineGroundingShadowTimeoutMsFromEnv(env = process.env) {
  return positiveIntFromEnv(env, 'ZURI_LINE_GROUNDING_SHADOW_TIMEOUT_MS', LINE_GROUNDING_SHADOW_DEFAULT_TIMEOUT_MS)
}

// ADR-090's Phase 3 plan pairs exactly the default mode and the
// fallback-bearing corpus mode (design doc §10.1 Phase 3: "switch one DIRECT
// LINE OA account to GKS_THEN_BUSINESS_KNOWLEDGE; shadow-compare answers
// against business_knowledge"). `GKS_CORPUS` has no defined partner: it never
// falls back to business knowledge by design (ADR-090 D2), so there is no
// symmetric "what would the curated table have said" comparison to make for
// it — an account left on GKS_CORPUS with the shadow flag on simply never
// produces a comparison row. This is a deliberate no-op, never a thrown error.
const PAIRED_MODE = Object.freeze({
  BUSINESS_KNOWLEDGE: 'GKS_THEN_BUSINESS_KNOWLEDGE',
  GKS_THEN_BUSINESS_KNOWLEDGE: 'BUSINESS_KNOWLEDGE',
})

export function otherGroundingMode(mode) {
  return PAIRED_MODE[mode] ?? null
}

function truncateText(text, max = ANSWER_TEXT_MAX_CHARS) {
  if (typeof text !== 'string') return null
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function timeoutFailure() {
  return Object.assign(new Error('LINE_GROUNDING_SHADOW_TIMED_OUT'), { code: 'LINE_GROUNDING_SHADOW_TIMED_OUT' })
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(timeoutFailure())
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * The read-only `knowledge.query` reader for `mode`, reusing the same
 * corpus/business-knowledge readers and budget the primary answer used.
 * `capturedHops` receives each `EVIDENCE_SELECTED`-shaped hop the corpus
 * reader attempts — captured in memory only, never written to the job's real
 * `AgentTraceEvent` journal, which belongs to the turn actually shown to the
 * customer.
 */
function buildShadowReader({ mode, tenantId, businessId, businessKnowledgeReader, env, capturedHops }) {
  if (mode === 'BUSINESS_KNOWLEDGE') return businessKnowledgeReader
  const budget = lineKnowledgeGroundingBudgetFromEnv(env)
  const corpusReader = createCorpusKnowledgeReader({ tenantId, businessId, ...budget })
  const captureTrace = { recordEvidence: async (_input, _evidence, meta) => { capturedHops.push(meta) } }
  return createLineGroundingReader({ mode, corpusReader, businessKnowledgeReader, trace: captureTrace, budgetMs: budget.budgetMs })
}

function lastHopFor(source, hops) {
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    if (hops[index]?.source === source) return hops[index]
  }
  return null
}

/**
 * Derive `{ shadowEvidenceSource, shadowEvidenceReason, shadowRetrievalRefs }`
 * from a completed shadow answer. For `BUSINESS_KNOWLEDGE` there is no hop
 * list (the reader is used unwrapped, exactly like the primary path's
 * default mode), so evidence presence is read from the answer directly; for
 * a corpus mode the decisive (last-attempted) hop `createLineGroundingReader`
 * recorded is authoritative — it is the same hop the primary path would have
 * traced as `EVIDENCE_SELECTED` had this been the live mode.
 */
function evidenceSummary({ mode, result, hops }) {
  const recordCount = Array.isArray(result?.evidence?.records) ? result.evidence.records.length : 0
  if (mode === 'BUSINESS_KNOWLEDGE') {
    return {
      shadowEvidenceSource: recordCount > 0 ? 'BUSINESS_KNOWLEDGE' : 'NONE',
      shadowEvidenceReason: recordCount > 0 ? null : 'NO_EVIDENCE',
      shadowRetrievalRefs: null,
    }
  }
  const decisive = hops.length ? hops[hops.length - 1] : null
  const corpusHop = lastHopFor('GKS_CORPUS', hops)
  return {
    shadowEvidenceSource: decisive?.source ?? (recordCount > 0 ? 'UNKNOWN' : 'NONE'),
    shadowEvidenceReason: decisive?.reason ?? (recordCount > 0 ? null : 'NO_EVIDENCE'),
    shadowRetrievalRefs: corpusHop?.retrievalRefs?.length ? corpusHop.retrievalRefs : null,
  }
}

/**
 * Persist one comparison row, upserting on `jobId` so a re-claimed job (rare
 * — the worker fences by CAS + lease) overwrites its own prior attempt rather
 * than accumulating duplicates. Never throws: a write failure (including a
 * missing table before the migration is applied) is diagnostic-only and must
 * never surface to a caller that does not await this function.
 */
async function persistComparison(db, row) {
  try {
    const data = {
      tenantId: row.tenantId,
      businessId: row.businessId,
      accountId: row.accountId ?? null,
      primaryMode: row.primaryMode,
      shadowMode: row.shadowMode,
      status: row.status,
      primaryAnswerText: row.primaryAnswerText,
      shadowAnswerText: row.shadowAnswerText,
      shadowEvidenceSource: row.shadowEvidenceSource,
      shadowEvidenceReason: row.shadowEvidenceReason,
      shadowRetrievalRefsJson: row.shadowRetrievalRefs ? JSON.stringify(row.shadowRetrievalRefs) : null,
      answersDiverge: row.answersDiverge,
      latencyMs: row.latencyMs,
      errorCode: row.errorCode,
    }
    await db.lineGroundingShadowComparison.upsert({
      where: { jobId: row.jobId },
      create: { jobId: row.jobId, ...data },
      update: data,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Run the paired mode's grounding + generation for one already-answered job
 * and persist a comparison row. Intended to be called WITHOUT `await` from
 * the customer-facing path, right after the primary answer text is known —
 * see `server-line-answer.js`'s own note on why that is the least invasive
 * hook point. Always resolves (never rejects) so a stray `.catch` at the call
 * site is a belt-and-braces measure, not a requirement.
 *
 * Known scope limit (flagged for the owner, not solved here): on a
 * memory-opt-in turn, the shadow generation is grounding-only — `model` is
 * always the plain resolved provider (never the MSP injection wrapper) and
 * `contextPacket` is always `null`, so it never re-enters MSP thread memory
 * or appends a second exchange. This means a memory-opt-in turn's shadow
 * answer is not exactly what the paired mode would have produced WITH memory
 * context — only what it would have produced from grounding evidence alone.
 * Comparing the full memory-composed turn is future work.
 */
export async function runLineGroundingShadowCompare({
  job,
  primaryMode,
  primaryAnswerText,
  tenantId,
  businessId,
  question,
  model,
  businessKnowledgeReader,
  env = process.env,
  db = prisma,
  timeoutMs,
  now = () => new Date(),
} = {}) {
  if (job?.account?.knowledgeGroundingShadow !== true) return null
  const shadowMode = otherGroundingMode(primaryMode)
  if (!shadowMode) return null
  if (!job?.id || !tenantId || !businessId || typeof question !== 'string' || !question.trim()
    || typeof model?.generate !== 'function' || typeof businessKnowledgeReader?.query !== 'function') {
    return null
  }
  const budgetMs = timeoutMs ?? lineGroundingShadowTimeoutMsFromEnv(env)
  const startedAt = now().getTime()
  const hops = []
  let status = 'FAILED'
  let errorCode = null
  let shadowAnswerText = null
  let summary = { shadowEvidenceSource: null, shadowEvidenceReason: null, shadowRetrievalRefs: null }

  try {
    const reader = buildShadowReader({ mode: shadowMode, tenantId, businessId, businessKnowledgeReader, env, capturedHops: hops })
    const result = await withTimeout(
      answerBusinessQuestion({ tenantId, businessId, question }, { knowledge: reader, model, contextPacket: null }),
      budgetMs,
    )
    shadowAnswerText = typeof result?.text === 'string' ? result.text : null
    summary = evidenceSummary({ mode: shadowMode, result, hops })
    status = 'COMPLETED'
  } catch (error) {
    status = error?.code === 'LINE_GROUNDING_SHADOW_TIMED_OUT' ? 'TIMED_OUT' : 'FAILED'
    // The shadow model/reader failure may carry SQL, a stack or a credential —
    // exactly the same discipline line-knowledge-grounding.js applies to the
    // primary path's own GKS hop. Only a stable code is ever persisted.
    errorCode = error?.code && typeof error.code === 'string' ? error.code : 'LINE_GROUNDING_SHADOW_UNAVAILABLE'
  }

  const latencyMs = now().getTime() - startedAt
  const answersDiverge = status === 'COMPLETED' && typeof shadowAnswerText === 'string' && typeof primaryAnswerText === 'string'
    ? shadowAnswerText.trim() !== primaryAnswerText.trim()
    : null

  const persisted = await persistComparison(db, {
    jobId: job.id,
    tenantId,
    businessId,
    accountId: job.accountId ?? job.account?.id ?? null,
    primaryMode,
    shadowMode,
    status,
    primaryAnswerText: truncateText(primaryAnswerText),
    shadowAnswerText: truncateText(shadowAnswerText),
    shadowEvidenceSource: summary.shadowEvidenceSource,
    shadowEvidenceReason: summary.shadowEvidenceReason,
    shadowRetrievalRefs: summary.shadowRetrievalRefs,
    answersDiverge,
    latencyMs,
    errorCode,
  })

  return { status, shadowMode, answersDiverge, latencyMs, persisted }
}
