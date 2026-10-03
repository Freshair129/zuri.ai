// @req FR-049 — answer from a bounded evidence packet and reject unsupported claims.
// @req FR-171 — pass an execution observer through to each provider attempt.
// @req FR-235 — `evidence.records` may now also be `{kind:'CORPUS_CHUNK', text,
// citationId, ...}` rows from the GKS grounding reader (ADR-090), not only
// `zuri_core.business_knowledge` product rows. `verifyCandidate` already works
// unchanged (it only stringifies `evidence.records` looking for numbers/codes);
// `deterministicFallback` gets one added branch so a LOCAL_ONLY/deterministic
// or a provider-fallback answer over corpus evidence returns the chunk text
// instead of reading product-row fields corpus evidence does not have. Every
// existing evidence shape is untouched: this branch only ever fires for a
// record actually carrying `kind: 'CORPUS_CHUNK'`.
// @req FR-149 — the candidate check, the evidence fallback and the no-evidence
// reply live in line-answer-policy.js, which the Conversation Runtime mirrors, so
// both answer paths apply the same post-model rules.
// @spec SDD-025, SEC-009 — provider wording is advisory; evidence remains authoritative.
// @tested tests/unit/grounded-business-answer.test.js

import {
  NO_EVIDENCE_REPLY,
  checkModelAnswer,
  deterministicFallback,
  normalizedCodes,
} from './line-answer-policy'

// @req FR-235 — exported so a caller that must pre-fetch this turn's evidence
// (server-line-answer.js, to compose knowledge evidence with MSP slices under
// one budget before answerBusinessQuestion decides whether to call a model)
// derives the exact same registered query answerBusinessQuestion would, from
// a pure function of `question` alone — never a second, diverging derivation.
export function selectRegisteredQuery(question) {
  const codes = [...normalizedCodes(question)].filter((code) => /\d/.test(code))
  if (/(เทียบ|เปรียบเทียบ|ต่างกัน)/i.test(question) && codes.length >= 2) {
    return { queryId: 'product_compare', params: { productCodes: codes.slice(0, 3) }, limit: 3 }
  }
  if (codes.length >= 1) return { queryId: 'product_detail', params: { productCode: codes[0] }, limit: 1 }
  return { queryId: 'product_search', params: { term: question }, limit: 5 }
}

/** @req FR-149 — server LOCAL_ONLY answers never invoke a model provider. */
export function createDeterministicBusinessModel() {
  return Object.freeze({
    provider: 'deterministic',
    model: 'business-evidence-v1',
    async generate({ evidence }) {
      return { provider: 'deterministic', model: 'business-evidence-v1', status: 'ok', text: deterministicFallback(evidence) }
    },
  })
}

export async function answerBusinessQuestion({ tenantId, businessId, question }, { knowledge, model, trace, contextPacket = null }) {
  if (!businessId) throw new Error('BUSINESS_ID_REQUIRED')
  if (!question?.trim()) throw new Error('QUESTION_REQUIRED')
  const selected = selectRegisteredQuery(question)
  const evidence = await knowledge.query({ tenantId, businessId, ...selected })

  if (!evidence.records?.length) {
    return {
      text: NO_EVIDENCE_REPLY,
      grounded: false,
      evidence,
      provider: { provider: model.provider, model: model.model, status: 'not-called' },
      verification: { supported: true, reason: 'no-evidence-no-generation' },
    }
  }

  try {
    const generated = await model.generate({ question, evidence, contextPacket, ...(trace ? { trace } : {}) })
    const checked = checkModelAnswer(question, evidence, generated.text)
    if (checked.status === 'ok') {
      return { text: generated.text, grounded: true, evidence, provider: generated, verification: checked.verification }
    }
    return {
      text: checked.text,
      grounded: true,
      evidence,
      provider: { provider: model.provider, model: model.model, status: 'rejected-output' },
      verification: checked.verification,
    }
  } catch (error) {
    if (error?.code === 'MSP_INJECTION_RECEIPT_UNKNOWN') throw error
    // @req FR-079 — local Ollama is an explicit evaluation provider; an unavailable
    // server/model must fail closed and never turn into an implicit provider fallback.
    if (model.provider === 'ollama') throw new Error('OLLAMA_PROVIDER_NOT_READY')
    return {
      text: deterministicFallback(evidence),
      grounded: true,
      evidence,
      provider: { provider: model.provider, model: model.model, status: 'fallback' },
      verification: { supported: true, reason: 'provider-fallback' },
    }
  }
}
