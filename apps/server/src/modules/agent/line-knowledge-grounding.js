import { KNOWLEDGE_GROUNDING_MODES } from '@/lib/validation/enums'

// @req FR-235 — the per-account grounding mode (`LineOaAccount.knowledgeGrounding`,
// ADR-090 D1) selects which evidence source(s) a LINE turn's single
// `knowledge.query` call reads before `answerBusinessQuestion` decides whether
// to invoke a model. `BUSINESS_KNOWLEDGE` is not handled here at all — it is
// today's reader, used completely unwrapped, so its trace stays byte-identical
// (ADR-090 "Required proof" 1). This module exists only for the two corpus
// modes.
// @spec ADR-090 D2 — fallback is mode-gated and traced: `GKS_CORPUS` never
//   falls back (a Business that retired the curated table has nothing to fall
//   back to); `GKS_THEN_BUSINESS_KNOWLEDGE` falls back to business knowledge
//   only on `GKS_UNAVAILABLE` or `NO_EVIDENCE`. No evidence from any allowed
//   source means the caller's existing "no evidence, no model call" gate
//   fires exactly as it does today (`records: []`), never a special case here.
// @spec ADR-090 D3 — the GKS hop is time-budgeted; a timeout or a thrown error
//   from the corpus reader is `GKS_UNAVAILABLE`, never a slower answer and
//   never a leaked internal error (SQL, stack, credentials).
// @spec SEC-032 — every hop writes exactly one `EVIDENCE_SELECTED` trace event
//   (source, reason, budget, retrieval references) and never the evidence's
//   own customer-identifying content, because there is none in a Business's
//   own published corpus or its curated knowledge table.
// @tested tests/unit/line-knowledge-grounding.test.js

export const DEFAULT_LINE_KNOWLEDGE_BUDGET_MS = 2500

function failure(code) {
  return Object.assign(new Error(code), { code })
}

function positiveIntFromEnv(env, key, fallback) {
  const raw = env?.[key]
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Configuration is read from the environment, never hard-coded (SDD-099). */
export function lineKnowledgeGroundingBudgetFromEnv(env = process.env) {
  return {
    budgetMs: positiveIntFromEnv(env, 'ZURI_LINE_KNOWLEDGE_BUDGET_MS', DEFAULT_LINE_KNOWLEDGE_BUDGET_MS),
    topK: positiveIntFromEnv(env, 'ZURI_LINE_KNOWLEDGE_TOP_K', 5),
    maxPacketBytes: positiveIntFromEnv(env, 'ZURI_LINE_KNOWLEDGE_MAX_PACKET_BYTES', 8192),
  }
}

/** A mode this reader was never built to run for a Business fails closed, never permissively. */
export function resolveLineKnowledgeGroundingMode(rawMode) {
  return KNOWLEDGE_GROUNDING_MODES.includes(rawMode) ? rawMode : 'BUSINESS_KNOWLEDGE'
}

function withBudget(promise, budgetMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(failure('GKS_UNAVAILABLE'))
    }, budgetMs)
    if (typeof timer.unref === 'function') timer.unref()
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        // Any failure of the GKS hop — timeout, MSP spawn failure, worker
        // error, authorization refusal — is GKS_UNAVAILABLE. The original
        // error is deliberately discarded: it may carry SQL, a stack trace or
        // a credential, none of which may reach the trace journal.
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(failure('GKS_UNAVAILABLE'))
      },
    )
  })
}

function hasRecords(evidence) {
  return Array.isArray(evidence?.records) && evidence.records.length > 0
}

/**
 * Wraps the plain `knowledge.query(input)` port with the ADR-090 mode-gated
 * read. `corpusReader` and `businessKnowledgeReader` are both already-scoped
 * `knowledge.query`-shaped readers — this module never resolves Business/
 * Tenant scope itself, and never sees a session or request-supplied actor.
 *
 * `trace`, when given, receives one `recordEvidence(input, evidence, meta)`
 * call per hop actually attempted: the console trace must show exactly why a
 * mode fell back (or did not), never fewer events than hops attempted and
 * never one describing a hop this call did not make.
 */
export function createLineGroundingReader({
  mode,
  corpusReader,
  businessKnowledgeReader,
  trace,
  budgetMs = DEFAULT_LINE_KNOWLEDGE_BUDGET_MS,
} = {}) {
  if (mode !== 'GKS_CORPUS' && mode !== 'GKS_THEN_BUSINESS_KNOWLEDGE') {
    throw failure('LINE_KNOWLEDGE_GROUNDING_MODE_INVALID')
  }
  if (typeof corpusReader?.query !== 'function') throw failure('LINE_KNOWLEDGE_GROUNDING_CORPUS_READER_REQUIRED')
  if (mode === 'GKS_THEN_BUSINESS_KNOWLEDGE' && typeof businessKnowledgeReader?.query !== 'function') {
    throw failure('LINE_KNOWLEDGE_GROUNDING_FALLBACK_READER_REQUIRED')
  }

  async function traceHop(input, evidence, meta) {
    if (trace) await trace.recordEvidence(input, evidence, meta)
  }

  return {
    async query(input) {
      const startedAt = Date.now()
      let corpusEvidence
      let corpusReason = null
      try {
        corpusEvidence = await withBudget(corpusReader.query(input), budgetMs)
        if (!hasRecords(corpusEvidence)) corpusReason = 'NO_EVIDENCE'
      } catch {
        corpusEvidence = { records: [] }
        corpusReason = 'GKS_UNAVAILABLE'
      }
      const elapsedMs = Date.now() - startedAt
      await traceHop(input, { records: corpusEvidence.records }, {
        mode,
        source: 'GKS_CORPUS',
        reason: corpusReason,
        retrievalRefs: corpusEvidence.retrievalRefs ?? [],
        budgetMs: elapsedMs,
      })
      if (hasRecords(corpusEvidence)) return corpusEvidence

      if (mode === 'GKS_CORPUS') {
        // No fallback for this mode (ADR-090 D2): the deterministic
        // "no evidence" reply is answerBusinessQuestion's own, unchanged rule.
        await traceHop(input, { records: [] }, { mode, source: 'NONE', reason: 'NO_EVIDENCE' })
        return { records: [] }
      }

      const fallbackEvidence = await businessKnowledgeReader.query(input)
      await traceHop(input, fallbackEvidence, { mode, source: 'BUSINESS_KNOWLEDGE', reason: corpusReason })
      if (hasRecords(fallbackEvidence)) return fallbackEvidence
      await traceHop(input, { records: [] }, { mode, source: 'NONE', reason: 'NO_EVIDENCE' })
      return fallbackEvidence
    },
  }
}
