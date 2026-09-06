import { z } from 'zod'

// @req FR-053, FR-054 — shared contracts freeze evaluation and canary readiness semantics.
// @spec BR-013, SDD-027, SEC-011 — readiness is dry-run, redacted and never delivery proof.
// @tested tests/unit/activation-readiness-contract.test.js

export const ACTIVATION_RECEIPT_STATES = Object.freeze([
  'GENERATED',
  'EVIDENCE_VERIFIED',
  'ACCEPTED_BY_LINE',
  'DISPLAYED_UNKNOWN',
  'READ_UNKNOWN',
])

const zGoldenQuestion = z.object({
  id: z.string().regex(/^GQ-[0-9]{2,}$/),
  question: z.string().min(1).max(500),
  expectedQueryId: z.enum(['product_search', 'product_detail', 'product_compare']),
  expectedEvidenceCodes: z.array(z.string().min(1)).max(50),
  expectedPolicy: z.enum(['ANSWER', 'FALLBACK', 'DENY_PRIVATE']),
  allowedNumericClaims: z.array(z.string().regex(/^-?[0-9]+(?:\.[0-9]+)?$/)).max(50),
}).strict()

const zGoldenCorpus = z.object({
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  cases: z.array(zGoldenQuestion).min(20),
}).strict().superRefine((value, context) => {
  const ids = new Set()
  for (const item of value.cases) {
    if (ids.has(item.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate golden question id: ${item.id}` })
    }
    ids.add(item.id)
  }
})

const zCanaryReadinessPlan = z.object({
  mode: z.literal('DRY_RUN').default('DRY_RUN'),
  projectRef: z.string().min(1),
  tenantId: z.string().uuid(),
  businessId: z.string().uuid(),
  bindingId: z.string().uuid(),
  bindingStatus: z.literal('PENDING'),
  bindingHashesPresent: z.literal(false),
  goldenReportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  isolationReportSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export function parseGoldenQuestionCorpus(value) {
  return zGoldenCorpus.parse(value)
}

export function parseCanaryReadinessPlan(value) {
  return zCanaryReadinessPlan.parse(value)
}
