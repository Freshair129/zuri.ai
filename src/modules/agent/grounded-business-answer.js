// @req FR-049 — answer from a bounded evidence packet and reject unsupported claims.
// @spec SDD-025, SEC-009 — provider wording is advisory; evidence remains authoritative.
// @tested tests/unit/grounded-business-answer.test.js

const PRODUCT_CODE = /\b[A-Z0-9][A-Z0-9._-]{2,}\b/gi
const NUMBER = /\d[\d,]*(?:\.\d+)?/g
const HIGH_RISK_CLAIM = /(ส่งฟรี|พร้อมส่ง|มีสต็อก|รับประกัน|จัดส่ง|ภายใน\s*\d+\s*วัน)/i

function normalizedNumbers(value) {
  return new Set((String(value).match(NUMBER) ?? []).map((item) => {
    const numeric = Number(item.replaceAll(',', ''))
    return Number.isFinite(numeric) ? String(numeric) : item
  }))
}

function normalizedCodes(value) {
  return new Set((String(value).match(PRODUCT_CODE) ?? []).map((item) => item.toLocaleUpperCase()))
}

function selectRegisteredQuery(question) {
  const codes = [...normalizedCodes(question)].filter((code) => /\d/.test(code))
  if (/(เทียบ|เปรียบเทียบ|ต่างกัน)/i.test(question) && codes.length >= 2) {
    return { queryId: 'product_compare', params: { productCodes: codes.slice(0, 3) }, limit: 3 }
  }
  if (codes.length >= 1) return { queryId: 'product_detail', params: { productCode: codes[0] }, limit: 1 }
  return { queryId: 'product_search', params: { term: question }, limit: 5 }
}

function verifyCandidate(question, evidence, candidate) {
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

function deterministicFallback(evidence) {
  const record = evidence.records[0]
  const facts = [`${record.name} (${record.product_code})`]
  if (record.sell_price !== null) facts.push(`ราคา ${formatValue(record.sell_price)} ${record.currency ?? 'THB'}/${record.unit ?? 'ชิ้น'}`)
  if (record.moq !== null) facts.push(`ขั้นต่ำ ${formatValue(record.moq)} ${record.unit ?? 'ชิ้น'}`)
  const specs = Object.entries(record.specification ?? {}).map(([key, value]) => `${key}: ${value}`)
  if (specs.length) facts.push(specs.join(', '))
  facts.push(`ข้อมูล ณ ${record.as_of.slice(0, 10)}`)
  return facts.join(' — ')
}

export async function answerBusinessQuestion({ tenantId, businessId, question }, { knowledge, model }) {
  if (!businessId) throw new Error('BUSINESS_ID_REQUIRED')
  if (!question?.trim()) throw new Error('QUESTION_REQUIRED')
  const selected = selectRegisteredQuery(question)
  const evidence = await knowledge.query({ tenantId, businessId, ...selected })

  if (!evidence.records?.length) {
    return {
      text: 'ยังไม่พบข้อมูลสินค้าที่ตรงกับคำถามนี้ค่ะ ลองระบุรหัสสินค้า หรือชื่อสินค้าเพิ่มอีกหนึ่งอย่างได้ไหมคะ',
      grounded: false,
      evidence,
      provider: { provider: model.provider, model: model.model, status: 'not-called' },
      verification: { supported: true, reason: 'no-evidence-no-generation' },
    }
  }

  try {
    const generated = await model.generate({ question, evidence })
    const verification = verifyCandidate(question, evidence, generated.text)
    if (verification.supported) {
      return { text: generated.text, grounded: true, evidence, provider: generated, verification }
    }
    return {
      text: deterministicFallback(evidence),
      grounded: true,
      evidence,
      provider: { provider: model.provider, model: model.model, status: 'rejected-output' },
      verification,
    }
  } catch {
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
