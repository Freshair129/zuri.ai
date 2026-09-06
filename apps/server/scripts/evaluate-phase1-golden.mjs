import { readFile } from 'node:fs/promises'
import { evaluateGoldenQuestions, validateGoldenQuestionCorpus } from '../src/modules/agent/golden-evaluation.js'

// @req FR-053 — provide a deterministic, production-disabled golden evaluation entry point.
// @spec SDD-027, SEC-011 — no provider network or credential is used by this script.
// @tested tests/unit/golden-evaluation.test.js

const corpusUrl = new URL('../contracts/phase1-activation/smartgift-golden-questions.json', import.meta.url)
const corpus = validateGoldenQuestionCorpus(JSON.parse(await readFile(corpusUrl, 'utf8')))

if (!process.argv.includes('--fake')) {
  process.stdout.write(`${JSON.stringify({
    contractVersion: '1.0.0',
    corpusVersion: corpus.version,
    corpusCases: corpus.cases.length,
    evaluation: { status: 'NOT_RUN' },
    realProvider: { status: 'NOT_RUN' },
  }, null, 2)}\n`)
  process.exit(0)
}

const knowledge = {
  async query({ queryId, evaluationCaseId }) {
    const goldenCase = corpus.cases.find(({ id }) => id === evaluationCaseId)
    return {
      queryId,
      records: goldenCase.expectedEvidenceCodes.map((productCode) => ({
        product_code: productCode,
        name: `Public product ${productCode}`,
        sensitivity: 'PUBLIC',
      })),
    }
  },
}

const model = {
  provider: 'fake',
  model: 'deterministic',
  async generate({ goldenCase }) {
    return {
      text: goldenCase.allowedNumericClaims.length
        ? `Public evidence ${goldenCase.allowedNumericClaims.join(' ')}`
        : 'Public evidence verified',
    }
  },
}

const report = await evaluateGoldenQuestions({
  corpus,
  tenantId: '00000000-0000-4000-8000-000000000001',
  businessId: '00000000-0000-4000-8000-000000000002',
}, { knowledge, model })

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exitCode = report.status === 'PASS' ? 0 : 1
