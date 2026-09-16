import { z } from 'zod'

// @req FR-171 — bind an observed MSP write to its committed context and action attempt.
// @spec ADR-070, FR-057 — provenance validation grants no private-memory permission.
// @tested tests/integration/memory-trace-linkage.test.js

const ref = z.string().min(1).max(512).refine(value => value.trim() === value)
const hash = z.string().regex(/^[a-f0-9]{64}$/i)
const reference = z.object({
  memoryId: ref.nullable(), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  sourceVaultId: ref.nullable(), key: ref.nullable(), category: ref.nullable(),
  sourceHash: hash.nullable(), snapshotHash: hash,
}).strict()
const writeInput = z.object({
  operation: z.literal('MSP_MEMORY_UPSERT'), vaultId: ref, key: ref, category: ref, bodyHash: hash,
}).strict()

const contract = z.object({
  schemaVersion: z.literal('memory-write-trace.v1'),
  ctxId: z.string().uuid(), actionId: z.string().uuid(), actionAttemptId: z.string().uuid(),
  source: z.literal('MSP_API_009'),
  sessionAuthority: z.literal('NOT_ATTESTED_BY_API_009'),
  receipt: z.object({
    status: z.enum(['ACKNOWLEDGED', 'INCOMPLETE', 'UNAVAILABLE', 'UNKNOWN']),
    observedAt: z.string().datetime({ offset: true }),
    reference: reference.nullable(),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.receipt.status === 'ACKNOWLEDGED' &&
    (!value.receipt.reference || Object.values(value.receipt.reference).some(field => field === null))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Acknowledgement requires source identity' })
  }
})

function payload(event) {
  try { return event.payload ?? JSON.parse(event.payloadJson) } catch { return null }
}

/** Pure consistency check: neither invokes an effect nor treats historical policy as a grant. */
export function inspectMemoryWriteLink(event, events, { verifyContext, digest }) {
  const parsed = contract.safeParse(payload(event))
  if (!parsed.success) return { reasons: ['MEMORY_TRACE_PAYLOAD_INVALID'], payload: null }
  const value = parsed.data
  const reasons = []
  if (['tenantId', 'businessId', 'turnId', 'executionId'].some(field => !z.string().uuid().safeParse(event[field]).success)) {
    reasons.push('MEMORY_TRACE_SCOPE_OR_EXECUTION_INVALID')
  }
  const turn = events.filter(row => row && row.tenantId === event.tenantId && row.businessId === event.businessId
    && row.turnId === event.turnId)
  if (turn.some(row => row.executionId !== event.executionId &&
    ((row.kind === 'CONTEXT_COMMITTED' && payload(row)?.ctxId === value.ctxId)
      || (row.kind === 'ACTION_STARTED' && payload(row)?.actionAttemptId === value.actionAttemptId)))) {
    reasons.push('MEMORY_TRACE_OCCURRENCE_REUSED')
  }
  const peers = turn.filter(row => row.executionId === event.executionId)
  const contexts = peers.filter(row => row.kind === 'CONTEXT_COMMITTED' && payload(row)?.ctxId === value.ctxId)
  if (contexts.length !== 1) reasons.push('MEMORY_TRACE_CONTEXT_MISSING_OR_CONFLICTING')
  else if (!verifyContext(payload(contexts[0]), [])) reasons.push('MEMORY_TRACE_CONTEXT_INVALID')
  const actions = peers.filter(row => row.kind === 'ACTION_STARTED'
    && payload(row)?.actionAttemptId === value.actionAttemptId)
  if (actions.length !== 1) reasons.push('MEMORY_TRACE_ACTION_MISSING_OR_CONFLICTING')
  else {
    const action = payload(actions[0])
    if (action.ctxId !== value.ctxId || action.actionId !== value.actionId) reasons.push('MEMORY_TRACE_ACTION_MISMATCH')
    try {
      if (!Object.hasOwn(action, 'input') || action.inputHash !== digest(action.input)) reasons.push('MEMORY_TRACE_ACTION_INPUT_INVALID')
    } catch { reasons.push('MEMORY_TRACE_ACTION_INPUT_INVALID') }
    const input = writeInput.safeParse(action.input)
    if (!input.success) reasons.push('MEMORY_TRACE_ACTION_TARGET_INVALID')
    else if (value.receipt.reference) {
      const written = value.receipt.reference
      const expected = input.data
      if ([['sourceVaultId', 'vaultId'], ['key', 'key'], ['category', 'category'], ['snapshotHash', 'bodyHash']]
        .some(([source, target]) => written[source] !== null && written[source] !== expected[target])) {
        reasons.push('MEMORY_TRACE_WRITE_TARGET_MISMATCH')
      }
    }
  }
  return { reasons, payload: value }
}
