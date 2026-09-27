// @req FR-049 — model wording is accepted only when its numbers, codes and
// delivery claims are in the evidence; otherwise the reply is built from evidence.
// @req FR-149, FR-235 — the LINE answer rules after retrieval and after the model:
// the no-evidence reply, the candidate check, the evidence fallback and the LINE
// text bound. The Server answer path and the Conversation Runtime apply the same
// rules, so the same model output over the same evidence gives the same reply.
// @spec SDD-025, SEC-009 — provider wording is advisory; evidence remains authoritative.
// @spec ADR-106 D1, SDD-110 — pure text rules, no I/O and no imports.
//
// ONE SOURCE, TWO PLACES. This file exists byte for byte at
//   apps/server/src/modules/agent/line-answer-policy.js       (authored here)
//   services/conversation-runtime/src/line-answer-policy.js   (mirror)
// The Runtime may not import apps/server (its build scan refuses it) and the
// apps/server image cannot reach services/ (its build context is apps/server), so a
// shared import is not possible for both images. Edit the apps/server copy, then
// copy it over the mirror unchanged. The drift test fails on any difference.
// @tested tests/unit/grounded-business-answer.test.js,
//   tests/integration/conversation-runtime-answer-parity.test.js,
//   services/conversation-runtime/test/answer-policy.test.js

const PRODUCT_CODE = /\b[A-Z0-9][A-Z0-9._-]{2,}\b/gi
const NUMBER = /\d[\d,]*(?:\.\d+)?/g
const HIGH_RISK_CLAIM = /(ส่งฟรี|พร้อมส่ง|มีสต็อก|รับประกัน|จัดส่ง|ภายใน\s*\d+\s*วัน)/i

/** LINE's text message limit, in UTF-16 code units. */
export const LINE_TEXT_LIMIT = 5000

/** The reply when retrieval found no evidence. The model is not called. */
export const NO_EVIDENCE_REPLY = 'ยังไม่พบข้อมูลสินค้าที่ตรงกับคำถามนี้ค่ะ ลองระบุรหัสสินค้า หรือชื่อสินค้าเพิ่มอีกหนึ่งอย่างได้ไหมคะ'

function normalizedNumbers(value) {
  return new Set((String(value).match(NUMBER) ?? []).map((item) => {
    const numeric = Number(item.replaceAll(',', ''))
    return Number.isFinite(numeric) ? String(numeric) : item
  }))
}

export function normalizedCodes(value) {
  return new Set((String(value).match(PRODUCT_CODE) ?? []).map((item) => item.toLocaleUpperCase()))
}

/**
 * A candidate is supported when every number and every digit-bearing code in it
 * appears in the question or the evidence, and it makes no delivery or stock
 * claim the evidence does not make.
 */
export function verifyCandidate(question, evidence, candidate) {
  const authority = `${question}\n${JSON.stringify(evidence.records)}`
  const allowedNumbers = normalizedNumbers(authority)
  const unsupportedNumbers = [...normalizedNumbers(candidate)].filter((number) => !allowedNumbers.has(number))
  const allowedCodes = normalizedCodes(authority)
  const unsupportedCodes = [...normalizedCodes(candidate)]
    .filter((code) => /\d/.test(code) && !allowedCodes.has(code))
  const riskyClaim = HIGH_RISK_CLAIM.test(candidate) && !HIGH_RISK_CLAIM.test(JSON.stringify(evidence.records))
  return {
    supported: unsupportedNumbers.length === 0 && unsupportedCodes.length === 0 && !riskyClaim,
    unsupportedNumbers,
    unsupportedCodes,
    riskyClaim,
  }
}

function formatValue(value) {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value)
}

/**
 * The reply built from the first evidence record alone, used when the model
 * output is rejected or the provider call fails. A GKS corpus chunk answers
 * with its own text; a product row answers with its name, price, minimum
 * order, specification and as-of date.
 */
export function deterministicFallback(evidence) {
  const record = evidence.records[0]
  if (record?.kind === 'CORPUS_CHUNK') {
    const text = typeof record.text === 'string' ? record.text.trim() : ''
    return text || NO_EVIDENCE_REPLY
  }
  const facts = [`${record.name} (${record.product_code})`]
  if (record.sell_price !== null) facts.push(`ราคา ${formatValue(record.sell_price)} ${record.currency ?? 'THB'}/${record.unit ?? 'ชิ้น'}`)
  if (record.moq !== null) facts.push(`ขั้นต่ำ ${formatValue(record.moq)} ${record.unit ?? 'ชิ้น'}`)
  const specs = Object.entries(record.specification ?? {}).map(([key, value]) => `${key}: ${value}`)
  if (specs.length) facts.push(specs.join(', '))
  facts.push(`ข้อมูล ณ ${record.as_of.slice(0, 10)}`)
  return facts.join(' — ')
}

/**
 * The rule after a model call that returned text: a supported candidate is the
 * reply as written; an unsupported one is replaced by the evidence fallback.
 * `status` uses the Server provider status names: `ok` or `rejected-output`.
 */
export function checkModelAnswer(question, evidence, candidate) {
  const verification = verifyCandidate(question, evidence, candidate)
  return verification.supported
    ? { text: candidate, status: 'ok', verification }
    : { text: deterministicFallback(evidence), status: 'rejected-output', verification }
}

/**
 * Bound a reply to LINE's text limit without leaving a split surrogate pair at
 * the cut, which an emoji in an evidence value can otherwise produce.
 */
export function boundLineText(text) {
  return text.slice(0, LINE_TEXT_LIMIT).replace(/[\uD800-\uDBFF]$/, '')
}
