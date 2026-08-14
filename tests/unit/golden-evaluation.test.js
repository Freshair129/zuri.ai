import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  evaluateGoldenQuestions,
  readRealProviderConfiguration,
  validateGoldenQuestionCorpus,
} from '@/modules/agent/golden-evaluation'

// @req FR-053 — golden evaluation proves bounded evidence and policy outcomes.
// @spec SDD-027, SEC-011
// @tested tests/unit/golden-evaluation.test.js

const corpusPath = new URL('../../contracts/phase1-activation/smartgift-golden-questions.json', import.meta.url)

async function loadCorpus() {
  return JSON.parse(await readFile(corpusPath, 'utf8'))
}

function publicRecord(productCode, numericValue = '120') {
  return {
    product_code: productCode,
    name: `Product ${productCode}`,
    description: `Public value ${numericValue}`,
    sensitivity: 'PUBLIC',
  }
}

describe('golden evaluation (FR-053)', () => {
  it('validates a secret-safe corpus with at least 20 unique cases', async () => {
    const corpus = await loadCorpus()

    const parsed = validateGoldenQuestionCorpus(corpus)

    expect(parsed.cases).toHaveLength(20)
    expect(new Set(parsed.cases.map(({ id }) => id)).size).toBe(20)
    expect(JSON.stringify(parsed)).not.toMatch(/password|authorization|reply.?token|cost|margin|invoice|email|phone/i)
  })

  it('passes 20/20 deterministic assertions with injected fake ports', async () => {
    const corpus = await loadCorpus()
    const knowledge = {
      query: vi.fn(async ({ queryId, evaluationCaseId }) => {
        const goldenCase = corpus.cases.find((item) => item.id === evaluationCaseId)
        return {
          queryId,
          records: goldenCase.expectedEvidenceCodes.map((code) => publicRecord(code, goldenCase.allowedNumericClaims[0] ?? '120')),
        }
      }),
    }
    const model = {
      provider: 'fake',
      model: 'deterministic',
      generate: vi.fn(async ({ goldenCase }) => ({
        text: goldenCase.allowedNumericClaims.length
          ? `ข้อมูล ${goldenCase.allowedNumericClaims.join(' ')}`
          : 'ข้อมูลสาธารณะที่ตรวจสอบแล้ว',
      })),
    }

    const report = await evaluateGoldenQuestions({ corpus, tenantId: 'tenant-a', businessId: 'business-a' }, { knowledge, model })

    expect(report.status).toBe('PASS')
    expect(report.summary).toEqual({ total: 20, passed: 20, failed: 0, unsupportedNumericClaims: 0 })
    expect(report.realProvider).toEqual({ status: 'NOT_RUN' })
    expect(report.cases).toHaveLength(20)
    expect(report.cases.every((item) => item.status === 'PASS')).toBe(true)
  })

  it('fails unsupported numeric claims and never serializes raw provider errors', async () => {
    const corpus = {
      version: '1.0.0',
      cases: Array.from({ length: 20 }, (_, index) => ({
        id: `GQ-${String(index + 1).padStart(2, '0')}`,
        question: `Public product question ${index + 1}`,
        expectedQueryId: 'product_detail',
        expectedEvidenceCodes: [`PUB-${String(index + 1).padStart(3, '0')}`],
        expectedPolicy: 'ANSWER',
        allowedNumericClaims: ['120'],
      })),
    }
    const knowledge = {
      query: vi.fn(async ({ productCode, queryId }) => ({ queryId, records: [publicRecord(productCode, '120')] })),
    }
    const model = {
      provider: 'fake',
      model: 'deterministic',
      generate: vi.fn(async ({ goldenCase }) => {
        if (goldenCase.id === 'GQ-01') return { text: 'ราคา 999 บาท' }
        if (goldenCase.id === 'GQ-02') throw new Error('provider failed with credential-redaction-sentinel')
        return { text: 'ราคา 120 บาท' }
      }),
    }

    const report = await evaluateGoldenQuestions({ corpus, tenantId: 'tenant-a', businessId: 'business-a' }, { knowledge, model })

    expect(report.status).toBe('FAIL')
    expect(report.summary.unsupportedNumericClaims).toBe(1)
    expect(report.cases.find(({ id }) => id === 'GQ-01').unsupportedNumericClaims).toEqual(['999'])
    expect(report.cases.find(({ id }) => id === 'GQ-02').outcome).toBe('FALLBACK')
    expect(JSON.stringify(report)).not.toContain('credential-redaction-sentinel')
  })

  it('enforces missing-evidence fallback and private-request denial without provider calls', async () => {
    const corpus = await loadCorpus()
    const selectedCases = corpus.cases.filter(({ expectedPolicy }) => expectedPolicy !== 'ANSWER')
    const selectedCorpus = {
      ...corpus,
      cases: [...selectedCases, ...corpus.cases.filter(({ expectedPolicy }) => expectedPolicy === 'ANSWER')].slice(0, 20),
    }
    const knowledge = { query: vi.fn(async ({ queryId }) => ({ queryId, records: [] })) }
    const model = { provider: 'fake', model: 'deterministic', generate: vi.fn() }

    const report = await evaluateGoldenQuestions({ corpus: selectedCorpus, tenantId: 'tenant-a', businessId: 'business-a' }, { knowledge, model })

    const denied = report.cases.filter(({ expectedPolicy }) => expectedPolicy === 'DENY_PRIVATE')
    const fallbacks = report.cases.filter(({ expectedPolicy }) => expectedPolicy === 'FALLBACK')
    expect(denied.length).toBeGreaterThan(0)
    expect(denied.every(({ outcome, status }) => outcome === 'DENY_PRIVATE' && status === 'PASS')).toBe(true)
    expect(fallbacks.length).toBeGreaterThan(0)
    expect(fallbacks.every(({ outcome, status }) => outcome === 'FALLBACK' && status === 'PASS')).toBe(true)
    expect(model.generate).not.toHaveBeenCalled()
  })

  it('reports only hashes and assertion metadata, not raw evidence or questions', async () => {
    const corpus = await loadCorpus()
    const knowledge = {
      query: vi.fn(async ({ queryId, productCode, productCodes }) => ({
        queryId,
        records: (productCodes ?? [productCode]).filter(Boolean).map((code) => ({
          ...publicRecord(code),
          internal_note: 'must-never-enter-report',
        })),
      })),
    }
    const model = { provider: 'fake', model: 'deterministic', generate: vi.fn(async () => ({ text: 'ข้อมูลสาธารณะ' })) }

    const report = await evaluateGoldenQuestions({ corpus, tenantId: 'tenant-a', businessId: 'business-a' }, { knowledge, model })
    const serialized = JSON.stringify(report)

    expect(report.corpusSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(serialized).not.toContain('must-never-enter-report')
    expect(serialized).not.toContain(corpus.cases[0].question)
    expect(serialized).not.toContain('tenant-a')
    expect(serialized).not.toContain('business-a')
  })

  it('reads real-provider configuration only from environment without exposing the credential', () => {
    const config = readRealProviderConfiguration({
      ZURI_GOLDEN_PROVIDER: 'approved-provider',
      ZURI_GOLDEN_MODEL: 'approved-model',
      ZURI_GOLDEN_PROVIDER_API_KEY: 'credential-redaction-sentinel',
    })

    expect(config).toEqual({
      provider: 'approved-provider',
      model: 'approved-model',
      credentialPresent: true,
      status: 'NOT_RUN',
    })
    expect(JSON.stringify(config)).not.toContain('credential-redaction-sentinel')
    expect(() => readRealProviderConfiguration({})).toThrow('REAL_PROVIDER_ENV_REQUIRED')
  })
})
