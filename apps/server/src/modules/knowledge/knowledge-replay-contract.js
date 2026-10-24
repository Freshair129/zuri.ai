// @req FR-173, FR-071 — owner retry is limited to the corrected Stage 16
// benchmark coverage failure, never a generic failed pipeline.
// @spec ADR-072, ADR-030 D4-D6
// @tested tests/unit/knowledge-replay-service.test.js, tests/unit/knowledge-admission-service.test.js

import { z } from 'zod'

export const knowledgeReplayInput = z.object({ idempotencyKey: z.string().trim().min(1).max(200) }).strict()

export const KNOWLEDGE_BENCHMARK_FAILURE_STAGE_ID = 'DPS-KI-INDEX'
export const KNOWLEDGE_BENCHMARK_FAILURE_CODE = 'BENCHMARK_NO_APPLICABLE_QUERIES'

function parseDetails(value) {
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function latestKnowledgeStageAttempt(stageSteps, run, pipelineStageId = KNOWLEDGE_BENCHMARK_FAILURE_STAGE_ID) {
  const candidates = (Array.isArray(stageSteps) ? stageSteps : [])
    .filter((step) => step?.runId === run?.id && step?.pipelineStageId === pipelineStageId)
    .map((step) => ({ step, createdAt: step.createdAt instanceof Date ? step.createdAt.getTime() : Date.parse(step.createdAt) }))
  if (candidates.some((candidate) => !Number.isFinite(candidate.createdAt) || !Number.isFinite(candidate.step.sequence))) return null
  candidates.sort((left, right) => right.step.sequence - left.step.sequence || right.createdAt - left.createdAt)
  const latest = candidates[0]
  if (!latest) return null
  const equallyCurrent = candidates.filter((candidate) => (
    candidate.step.sequence === latest.step.sequence && candidate.createdAt === latest.createdAt
  ))
  return equallyCurrent.length === 1 ? latest.step : null
}

export function isKnowledgeBenchmarkRetryEligible(ingestion, run, stageEvidence, { source, corpus, currentStageStep } = {}) {
  const evidence = Array.isArray(stageEvidence) ? stageEvidence : []
  const stage16Failures = evidence.filter((row) => row?.stageNumber === 16 && row?.outcome === 'FAILED')
  const qualified = stage16Failures.find((row) => {
    const details = parseDetails(row.detailsJson)
    return row.executionRunId === ingestion?.executionRunId
      && row.runId === run?.id
      && row.pipelineStageId === KNOWLEDGE_BENCHMARK_FAILURE_STAGE_ID
      && row.executionStepId === currentStageStep?.executionStepId
      && row.attemptId === currentStageStep?.attemptId
      && details?.error?.code === KNOWLEDGE_BENCHMARK_FAILURE_CODE
  })
  return ingestion?.status === 'FAILED'
    && (!source || (!source.deletedAt && !source.revokedAt && source.desiredRevision === ingestion.revision))
    && (!corpus || (!corpus.deletedAt && corpus.status === 'ACTIVE'))
    && typeof ingestion.executionRunId === 'string'
    && run?.executionRunId === ingestion.executionRunId
    && run?.status === 'FAILED'
    && run?.currentStageId === KNOWLEDGE_BENCHMARK_FAILURE_STAGE_ID
    && run?.primaryFailureCode === 'GENESISRAG17_EXTERNAL_STAGE_FAILED'
    && currentStageStep?.runId === run?.id
    && currentStageStep?.pipelineStageId === KNOWLEDGE_BENCHMARK_FAILURE_STAGE_ID
    && currentStageStep?.status === 'FAILED'
    && Boolean(qualified)
}
