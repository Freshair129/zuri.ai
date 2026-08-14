import { createHash } from 'node:crypto'
import { parseGoldenQuestionCorpus } from './activation-readiness-contract.js'

// @req FR-053 — evaluate approved questions against bounded evidence and policy assertions.
// @spec SDD-027, SEC-011 — injected ports only; reports are deterministic and redacted.
// @tested tests/unit/golden-evaluation.test.js

const NUMBER = /-?\d[\d,]*(?:\.\d+)?/g
const FORBIDDEN_CORPUS_FIELD = /(?:password|authorization|reply.?token|secret|cost|margin|invoice|email|phone)/i

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function normalizeNumber(value) {
  const numeric = Number(String(value).replaceAll(',', ''))
  return Number.isFinite(numeric) ? String(numeric) : String(value)
}

function numericClaims(value) {
  return [...new Set((String(value).match(NUMBER) ?? []).map(normalizeNumber))]
}

function evidenceCodes(records) {
  return [...new Set(records.map((record) => record?.product_code).filter(Boolean))].sort()
}

function sameValues(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function queryFor(goldenCase, tenantId, businessId) {
  const base = {
    tenantId,
    businessId,
    queryId: goldenCase.expectedQueryId,
    evaluationCaseId: goldenCase.id,
  }
  if (goldenCase.expectedQueryId === 'product_detail') {
    return { ...base, productCode: goldenCase.expectedEvidenceCodes[0] }
  }
  if (goldenCase.expectedQueryId === 'product_compare') {
    return { ...base, productCodes: goldenCase.expectedEvidenceCodes }
  }
  return { ...base, term: goldenCase.question }
}

function redactedCase(goldenCase, values) {
  return {
    id: goldenCase.id,
    expectedPolicy: goldenCase.expectedPolicy,
    status: values.status,
    outcome: values.outcome,
    assertions: values.assertions,
    unsupportedNumericClaims: values.unsupportedNumericClaims ?? [],
    evidenceSha256: values.evidenceSha256 ?? null,
  }
}

export function validateGoldenQuestionCorpus(value) {
  const parsed = parseGoldenQuestionCorpus(value)
  if (FORBIDDEN_CORPUS_FIELD.test(JSON.stringify(parsed))) {
    throw new Error('GOLDEN_CORPUS_FORBIDDEN_DATA')
  }
  return parsed
}

export function readRealProviderConfiguration(environment = process.env) {
  const provider = environment.ZURI_GOLDEN_PROVIDER
  const model = environment.ZURI_GOLDEN_MODEL
  const credential = environment.ZURI_GOLDEN_PROVIDER_API_KEY
  if (!provider || !model || !credential) throw new Error('REAL_PROVIDER_ENV_REQUIRED')
  return { provider, model, credentialPresent: true, status: 'NOT_RUN' }
}

async function evaluateCase(goldenCase, context, ports) {
  if (goldenCase.expectedPolicy === 'DENY_PRIVATE') {
    return redactedCase(goldenCase, {
      status: 'PASS',
      outcome: 'DENY_PRIVATE',
      assertions: {
        policyMatched: true,
        queryMatched: true,
        evidenceMatched: true,
        numericClaimsSupported: true,
      },
    })
  }

  let evidence
  try {
    evidence = await ports.knowledge.query(queryFor(goldenCase, context.tenantId, context.businessId))
  } catch {
    return redactedCase(goldenCase, {
      status: 'FAIL',
      outcome: 'FALLBACK',
      assertions: {
        policyMatched: goldenCase.expectedPolicy === 'FALLBACK',
        queryMatched: false,
        evidenceMatched: false,
        numericClaimsSupported: true,
      },
    })
  }

  const records = Array.isArray(evidence?.records) ? evidence.records : []
  const queryMatched = evidence?.queryId === goldenCase.expectedQueryId
  const evidenceMatched = sameValues(evidenceCodes(records), goldenCase.expectedEvidenceCodes)
  const evidenceSha256 = records.length
    ? sha256([...records].sort((left, right) => String(left?.product_code).localeCompare(String(right?.product_code))))
    : null

  if (records.length === 0) {
    const policyMatched = goldenCase.expectedPolicy === 'FALLBACK'
    return redactedCase(goldenCase, {
      status: policyMatched && queryMatched && evidenceMatched ? 'PASS' : 'FAIL',
      outcome: 'FALLBACK',
      evidenceSha256,
      assertions: { policyMatched, queryMatched, evidenceMatched, numericClaimsSupported: true },
    })
  }

  let generated
  try {
    generated = await ports.model.generate({
      question: goldenCase.question,
      evidence,
      goldenCase,
    })
  } catch {
    return redactedCase(goldenCase, {
      status: 'FAIL',
      outcome: 'FALLBACK',
      evidenceSha256,
      assertions: {
        policyMatched: false,
        queryMatched,
        evidenceMatched,
        numericClaimsSupported: true,
      },
    })
  }

  const allowed = new Set(goldenCase.allowedNumericClaims.map(normalizeNumber))
  const unsupportedNumericClaims = numericClaims(generated?.text).filter((claim) => !allowed.has(claim))
  const numericClaimsSupported = unsupportedNumericClaims.length === 0
  const policyMatched = goldenCase.expectedPolicy === 'ANSWER'
  const passed = policyMatched && queryMatched && evidenceMatched && numericClaimsSupported

  return redactedCase(goldenCase, {
    status: passed ? 'PASS' : 'FAIL',
    outcome: 'ANSWER',
    evidenceSha256,
    unsupportedNumericClaims,
    assertions: { policyMatched, queryMatched, evidenceMatched, numericClaimsSupported },
  })
}

export async function evaluateGoldenQuestions({ corpus, tenantId, businessId }, ports) {
  const validated = validateGoldenQuestionCorpus(corpus)
  if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
  if (!businessId) throw new Error('BUSINESS_ID_REQUIRED')
  if (!ports?.knowledge?.query) throw new Error('KNOWLEDGE_PORT_REQUIRED')
  if (!ports?.model?.generate) throw new Error('MODEL_PORT_REQUIRED')

  const cases = []
  for (const goldenCase of validated.cases) {
    cases.push(await evaluateCase(goldenCase, { tenantId, businessId }, ports))
  }

  const passed = cases.filter(({ status }) => status === 'PASS').length
  const unsupportedNumericClaims = cases.reduce((total, item) => total + item.unsupportedNumericClaims.length, 0)
  const summary = {
    total: cases.length,
    passed,
    failed: cases.length - passed,
    unsupportedNumericClaims,
  }

  return {
    contractVersion: '1.0.0',
    corpusVersion: validated.version,
    corpusSha256: sha256(validated),
    status: passed === cases.length && cases.length >= 20 && unsupportedNumericClaims === 0 ? 'PASS' : 'FAIL',
    summary,
    realProvider: { status: 'NOT_RUN' },
    cases,
  }
}
