import { z } from 'zod'

import {
  GATE_STATUSES,
  KNOWLEDGE_DIMENSION_RESULTS,
  KNOWLEDGE_GATE_VERDICTS,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
  zKnowledgeSnapshot,
  zKnowledgeStage17Dimensions,
  zKnowledgeStage17Evidence,
} from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-110 — published knowledge is represented by one strict snapshot and
// Stage 17's quality result is recorded as bounded evidence on the FR-071 gate.
// @spec SDD-057, ADR-042, ADR-043 D2.1, ADR-046, ADR-050 D3-D5,
// docs/domains/knowledge/features/FR-110-published-knowledge-snapshot-contract.md
// @tested tests/unit/knowledge-published-snapshot-contract.test.js

export {
  KNOWLEDGE_DIMENSION_RESULTS,
  KNOWLEDGE_GATE_VERDICTS,
  KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
  zKnowledgeSnapshot,
  zKnowledgeStage17Dimensions,
  zKnowledgeStage17Evidence,
}

const zId = z.string().trim().min(1).max(500)
const zMetricCount = z.number().finite().int().nonnegative()
const zMetricDuration = z.number().finite().nonnegative()
const zIsoTime = z.string().datetime({ offset: true })
const zKnowledgeScope = z.object({
  tenantId: zId,
  businessId: zId,
}).strict()

const zKnowledgeStageMetrics = z.object({
  records_in: zMetricCount,
  records_out: zMetricCount,
  records_failed: zMetricCount,
  records_quarantined: zMetricCount,
  processing_time: zMetricDuration,
  retry_count: zMetricCount,
}).strict()

/** What a stage occurrence reports about itself: it ran to completion, or it did not. */
export const KNOWLEDGE_STAGE_OUTCOMES = Object.freeze(['SUCCEEDED', 'FAILED'])

// BR-022's envelope as the ledger can hold it: a stable code, a redacted
// reference and the retryable flag. The raw error message is deliberately not
// a member — the FR-071 ledger is append-only and redacted (SDD-073), and a
// reporter that wants the message kept keeps it in its own tier.
const zKnowledgeStageFailure = z.object({
  failureCode: z.string().trim().min(1).max(200),
  errorRef: z.string().trim().min(1).max(200),
  retryable: z.boolean(),
}).strict()

// ADR-067 D2 — a report names when the stage ran, not when it was reported.
// The ledger's step timestamps are written from these, so `processing_time`
// is recoverable from the rows rather than only from the counter.
function refineReportedInterval(value, ctx) {
  if (Date.parse(value.finishedAt) < Date.parse(value.startedAt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['finishedAt'],
      message: 'finishedAt precedes startedAt',
    })
  }
}

/**
 * Control metadata plus aggregate-only evidence for a Stage 9–16 report.
 * Entity/fact/embedding/index rows and receipts remain in their owning tier.
 *
 * `outcome` and `failure` (ADR-067 D2): a stage that did not complete says so
 * with BR-022's envelope, and a stage that completed carries none — the two
 * are refined together so a report cannot be both, or neither.
 */
export const zKnowledgeStageReport = z.object({
  dataPipelineDefinitionId: z.literal(KNOWLEDGE_INGESTION_DEFINITION_ID),
  executionContractId: z.literal(KNOWLEDGE_INGESTION_CONTRACT_ID),
  executionRunId: zId,
  pipelineStageId: z.enum([...KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS]),
  executionStepId: zId,
  attemptId: zId,
  scope: zKnowledgeScope,
  outcome: z.enum([...KNOWLEDGE_STAGE_OUTCOMES]),
  failure: zKnowledgeStageFailure.nullable(),
  startedAt: zIsoTime,
  finishedAt: zIsoTime,
  metrics: zKnowledgeStageMetrics,
}).strict().superRefine((value, ctx) => {
  if (value.outcome === 'FAILED' && value.failure === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failure'],
      message: 'a FAILED stage report requires its BR-022 failure envelope',
    })
  }
  if (value.outcome === 'SUCCEEDED' && value.failure !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['failure'],
      message: 'a SUCCEEDED stage report carries no failure envelope',
    })
  }
  refineReportedInterval(value, ctx)
})

const zKnowledgeStage17Decision = z.object({
  dataPipelineDefinitionId: z.literal(KNOWLEDGE_INGESTION_DEFINITION_ID),
  executionContractId: z.literal(KNOWLEDGE_INGESTION_CONTRACT_ID),
  executionRunId: zId,
  pipelineStageId: z.literal(KNOWLEDGE_QUALITY_GATE_STAGE_ID),
  executionStepId: zId,
  attemptId: zId,
  scope: zKnowledgeScope,
  // This is FR-071's ledger vocabulary. Stage 17's quality vocabulary lives
  // under `verdict` and must never be substituted for this field.
  ledgerStatus: z.enum([...GATE_STATUSES]),
  verdict: z.enum([...KNOWLEDGE_GATE_VERDICTS]),
  snapshot: zKnowledgeSnapshot.nullable(),
  dimensions: zKnowledgeStage17Dimensions,
  startedAt: zIsoTime,
  finishedAt: zIsoTime,
}).strict().superRefine(refineReportedInterval)

/**
 * The request to close a knowledge ingestion run. It names the run and its
 * scope and nothing else — in particular no terminal status: the run's final
 * state is derived from the ledger by the receiver (ADR-067 D3), never
 * declared by whoever asks for it.
 */
const zKnowledgeRunFinish = z.object({
  dataPipelineDefinitionId: z.literal(KNOWLEDGE_INGESTION_DEFINITION_ID),
  executionContractId: z.literal(KNOWLEDGE_INGESTION_CONTRACT_ID),
  executionRunId: zId,
  scope: zKnowledgeScope,
  finishedAt: zIsoTime,
}).strict()

export function parseKnowledgeRunFinish(input) {
  return zKnowledgeRunFinish.parse(input)
}

function assertSnapshotScope(value) {
  if (value.snapshot === null) return
  if (value.snapshot.tenant_id !== value.scope.tenantId) {
    throw new Error('FR-110 snapshot tenant scope does not match the Stage 17 control scope')
  }
  if (value.snapshot.business_id !== value.scope.businessId) {
    throw new Error('FR-110 snapshot business scope does not match the Stage 17 control scope')
  }
}

export function parseKnowledgeStageReport(input) {
  return zKnowledgeStageReport.parse(input)
}

export function parseKnowledgeSnapshot(input) {
  return zKnowledgeSnapshot.parse(input)
}

export function parseKnowledgeStage17Evidence(input) {
  return zKnowledgeStage17Evidence.parse(input)
}

/**
 * Parses the Stage 17 control envelope and binds the snapshot scope to it.
 * The returned object intentionally keeps `ledgerStatus` separate from the
 * quality `verdict`; callers can project only its evidence into FR-071.
 */
export function parseKnowledgeStage17Decision(input) {
  const parsed = zKnowledgeStage17Decision.parse(input)
  parseKnowledgeStage17Evidence({
    verdict: parsed.verdict,
    snapshot: parsed.snapshot,
    dimensions: parsed.dimensions,
  })
  assertSnapshotScope(parsed)
  return parsed
}

/**
 * Produces the only FR-110 payload that may be attached to the shared
 * PipelineGateDecision evidence column.
 */
export function toKnowledgeStage17Evidence(input) {
  const parsed = parseKnowledgeStage17Decision(input)
  return {
    verdict: parsed.verdict,
    snapshot: parsed.snapshot,
    dimensions: parsed.dimensions,
  }
}

/**
 * Evaluates publication preconditions without publishing or mutating a row.
 * A PASS result is necessary, while explicit caller policy, an APPROVED FR-071
 * ledger status, a complete snapshot and no critical security finding are also
 * required. This helper deliberately returns reasons instead of inventing a
 * publication side effect for a future GKS/Genesis owner.
 */
export function evaluateKnowledgePublication(input, policy) {
  const decision = parseKnowledgeStage17Decision(input)
  const reasons = []
  const hasFailedDimension = Object.values(decision.dimensions)
    .some(({ result, critical }) => result === 'FAIL' || critical === true)

  if (policy?.allowPublish !== true) reasons.push('PUBLICATION_POLICY_NOT_ALLOWED')
  if (decision.ledgerStatus !== 'APPROVED') reasons.push('LEDGER_STATUS_NOT_APPROVED')
  if (!['PASS', 'PASS_WITH_WARNINGS'].includes(decision.verdict)) {
    reasons.push('QUALITY_VERDICT_BLOCKS_PUBLICATION')
  }
  if (decision.snapshot === null) reasons.push('SNAPSHOT_REQUIRED')
  if (hasFailedDimension) reasons.push('QUALITY_DIMENSION_BLOCKS_PUBLICATION')
  if (decision.dimensions.security.critical) reasons.push('CRITICAL_SECURITY_FAILURE')

  return { allowed: reasons.length === 0, reasons }
}
