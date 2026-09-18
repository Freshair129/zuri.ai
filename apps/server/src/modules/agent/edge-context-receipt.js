import { z } from 'zod'
// @req FR-234 — content-free receipts from each bounded Edge model invocation.
// @spec ADR-091 D7, SEC-001
// @tested tests/integration/server-line-jobs.test.js
const ref = z.string().min(1).max(300).regex(/^[a-zA-Z0-9_:.#/-]+$/)
export const zEdgeContextReceipt = z.object({
  receiptId: z.string().regex(/^ctxrcpt_[a-f0-9-]{36}$/),
  refs: z.object({ msp: z.array(ref).max(24), citations: z.array(ref).max(64), records: z.array(ref).max(64) }).strict(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  budget: z.object({ max: z.number().int().min(1).max(65536), used: z.number().int().min(0).max(65536),
    trimmed: z.number().int().min(0).max(10000), unit: z.literal('utf8-bytes') }).strict()
    .refine(value => value.used <= value.max),
  dropped: z.array(z.object({ id: ref, source: z.literal('MSP'),
    reason: z.enum(['THREAD_SCOPE_MISMATCH', 'AUDIENCE_SCOPE_DENIED', 'SUPERSEDED_BY_RECORD', 'BUDGET_TRIMMED']) }).strict()).max(24),
}).strict()
