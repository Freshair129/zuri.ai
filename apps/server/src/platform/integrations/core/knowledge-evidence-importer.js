import { z } from 'zod'
import prisma from '@/lib/db'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import {
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
} from './pipeline-tracking-contract'
import { recordKnowledgeStageReport } from './knowledge-ingestion-executor'

// @req FR-110 — the pull half of KNO-02: zuri-ai reads GKS's Tier-3 stage
//   evidence through MSP (`zuri-ai -> MSP -> gks_stage_evidence_export`) on its
//   own schedule, owns its cursor per scope, and applies every row through
//   the same receiver a push would use — so Stage 9–16 evidence lands on the
//   FR-071 ledger without GKS ever calling outward (AC-109.12, the lawful
//   direction of ADR-050 D3 and GKS's own ADR-GKS-LEDGER-REPORTING Option B).
// @req FR-109 — the evidence is attributed to a run by the `run_id` GKS was
//   given when the stage was executed, which is the run's `pipeline_job_id`.
// @spec ADR-068 D1-D4, ADR-067 D2, ADR-050 D3, ADR-043 D2, SDD-057, SEC-001
// @tested tests/integration/fr110-knowledge-evidence-importer.test.js
// @tested tests/integration/fr110-knowledge-evidence-chain.test.js

export const MSP_EVIDENCE_EXPORT_TOOL = 'msp_knowledge_evidence_export'
const IMPORTER_ACTOR = 'zuri-ai-knowledge-evidence-importer'
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const DEFAULT_MAX_PAGES = 10

const zId = z.string().trim().min(1).max(500)
const zScopePart = z.string().trim().max(500).default('')

/** GKS's KnowledgeScope, as the port contract requires it: an explicit portfolio, no wildcard. */
export const zKnowledgeScope = z.object({
  portfolioId: zId,
  tenantId: zScopePart,
  businessId: zScopePart,
  workspaceId: zScopePart,
  projectId: zScopePart,
  sharing: z.enum(['private', 'workspace', 'portfolio-shared']).default('private'),
}).strict()

const zPullRequest = z.object({
  scope: zKnowledgeScope,
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  maxPages: z.number().int().min(1).max(100).default(DEFAULT_MAX_PAGES),
}).strict()

const zMetric = z.number().finite().nonnegative()

/** One row of `gks_stage_evidence_export`, exactly as GKS's port contract v3 shapes it. */
export const zEvidenceRow = z.object({
  cursor: z.number().int().nonnegative(),
  evidence_id: z.string().startsWith('gks:evidence/'),
  pipeline_stage_id: z.string().regex(/^DPS-KI-[A-Z0-9]+(?:-[A-Z0-9]+)*$/),
  pipeline_definition_id: z.literal(KNOWLEDGE_INGESTION_DEFINITION_ID),
  execution_contract_id: z.literal(KNOWLEDGE_INGESTION_CONTRACT_ID),
  run_id: z.string().trim().min(1).nullable(),
  provenance_ref: z.string().trim().min(1),
  scope: zKnowledgeScope.nullable().optional(),
  evidence: z.record(z.string(), z.unknown()),
  metrics: z.object({
    records_in: zMetric,
    records_out: zMetric,
    records_failed: zMetric,
    records_quarantined: zMetric,
    processing_time_ms: zMetric,
    retry_count: zMetric,
  }).strict(),
  records: z.array(z.unknown()),
  produced_at: z.string().datetime({ offset: true }),
}).strict()

export const zEvidencePage = z.object({
  rows: z.array(zEvidenceRow),
  next_cursor: z.number().int().nonnegative(),
}).strict()

function serviceError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function scopeWhere(scope) {
  return {
    portfolioId_tenantId_businessId_workspaceId_projectId_sharing: {
      portfolioId: scope.portfolioId,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      sharing: scope.sharing,
    },
  }
}

/**
 * A row → the FR-110 stage report the receiver takes. Pure: the caller
 * supplies the run and the materialised step it resolved.
 *
 * GKS's export carries no outcome — a row exists because the stage executed
 * — so every row applies as `SUCCEEDED` with its counters; a failed *record*
 * is a count on a succeeded *stage*, exactly as the Tier 1 path reports
 * normalization declines (SDD-061). The execution's own interval is
 * reconstructed from `produced_at` and `processing_time_ms` (ADR-067 D2).
 */
export function stageReportFromEvidenceRow(row, run, step) {
  const finishedAt = new Date(row.produced_at)
  const startedAt = new Date(finishedAt.valueOf() - Math.round(row.metrics.processing_time_ms))
  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    executionRunId: run.executionRunId,
    pipelineStageId: row.pipeline_stage_id,
    executionStepId: step.executionStepId,
    attemptId: step.attemptId,
    scope: { tenantId: run.tenantId, businessId: run.businessId },
    outcome: 'SUCCEEDED',
    failure: null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    metrics: {
      records_in: row.metrics.records_in,
      records_out: row.metrics.records_out,
      records_failed: row.metrics.records_failed,
      records_quarantined: row.metrics.records_quarantined,
      processing_time: row.metrics.processing_time_ms,
      retry_count: row.metrics.retry_count,
    },
  }
}

/**
 * Decide what one exported row is to this ledger (ADR-068 D3). Pure.
 *
 * - `apply`: an external stage on a knowledge run this ledger holds.
 * - `unattributed`: evidence of an execution no run of ours owns — no
 *   `run_id` (a backfilled promotion, a human decision), or a `run_id` this
 *   ledger never minted. Recorded and passed over; the cursor advances.
 * - `held`: attributable, but not something this importer may write —
 *   GKS's half of the Stage 17 gate is dimensions without a verdict, and a
 *   verdict is not this importer's to invent. Recorded; the cursor advances.
 * - `blocked`: a contract violation on an attributable row — a Tier 1 stage
 *   id from a Tier 3 export, a scope that contradicts the run's, no
 *   materialised step. The cursor stops BEFORE this row (the CR's rule:
 *   an unmappable row blocks, it is never skipped), so it is seen again
 *   next pull and by whoever reads the result.
 */
export function classifyEvidenceRow(row, run, step) {
  if (!row.run_id) return { disposition: 'unattributed', reason: 'NO_RUN_ID' }
  if (!run) return { disposition: 'unattributed', reason: 'RUN_NOT_FOUND' }
  if (run.dataPipelineDefinitionId !== KNOWLEDGE_INGESTION_DEFINITION_ID) {
    return { disposition: 'unattributed', reason: 'NOT_A_KNOWLEDGE_RUN' }
  }
  if (row.scope?.tenantId && row.scope.tenantId !== run.tenantId) {
    return { disposition: 'blocked', reason: 'SCOPE_TENANT_MISMATCH' }
  }
  if (row.scope?.businessId && row.scope.businessId !== run.businessId) {
    return { disposition: 'blocked', reason: 'SCOPE_BUSINESS_MISMATCH' }
  }
  if (row.pipeline_stage_id === KNOWLEDGE_QUALITY_GATE_STAGE_ID) {
    return { disposition: 'held', reason: 'STAGE17_PARTIAL_EVIDENCE_NO_VERDICT' }
  }
  if (!KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS.includes(row.pipeline_stage_id)) {
    return { disposition: 'blocked', reason: `NOT_AN_EXTERNAL_STAGE:${row.pipeline_stage_id}` }
  }
  if (!step) return { disposition: 'blocked', reason: 'STEP_NOT_MATERIALISED' }
  return { disposition: 'apply', reason: null }
}

/**
 * One pull: from this scope's durable cursor, page through
 * `msp_knowledge_evidence_export` and apply every attributable row through
 * `recordKnowledgeStageReport`. Installation-operator only — this is zuri-ai
 * writing its own ledger, not an external reporter.
 *
 * The cursor is advanced once per page, after that page's writes committed,
 * to `next_cursor` — or, when a row blocks, to the cursor just before it.
 * Re-running after a crash replays the last page; the receiver's derived
 * idempotency keys make the replay `UNCHANGED` rather than duplicate.
 */
export async function pullKnowledgeStageEvidence(input, { db = prisma, viewer, transport, now = () => new Date() } = {}) {
  if (!isInstallationOperator(viewer)) throw serviceError(403, 'Knowledge evidence pull requires an installation operator')
  if (typeof transport !== 'function') throw serviceError(503, 'MSP transport is not configured (ZURI_MSP_COMMAND)')
  const request = zPullRequest.parse(input ?? {})
  const { scope } = request

  const cursorRow = await db.knowledgeEvidenceCursor.findUnique({ where: scopeWhere(scope) })
  const startCursor = cursorRow?.cursor ?? 0
  let cursor = startCursor
  const applied = []
  const unattributed = []
  const held = []
  let blocked = null
  let pages = 0

  while (pages < request.maxPages && !blocked) {
    const raw = await transport(MSP_EVIDENCE_EXPORT_TOOL, { actor: IMPORTER_ACTOR, scope, since_cursor: cursor, limit: request.limit })
    const page = zEvidencePage.parse(raw)
    pages += 1
    let last = cursor
    for (const row of page.rows) {
      if (row.cursor <= last) throw serviceError(502, `Evidence page is not cursor-ordered past ${last}`)
      const run = row.run_id ? await db.pipelineRun.findUnique({ where: { executionRunId: row.run_id } }) : null
      const step = run && KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS.includes(row.pipeline_stage_id)
        ? await db.pipelineStep.findFirst({ where: { runId: run.id, pipelineStageId: row.pipeline_stage_id }, orderBy: { createdAt: 'desc' } })
        : null
      const verdict = classifyEvidenceRow(row, run, step)
      if (verdict.disposition === 'unattributed') {
        unattributed.push({ cursor: row.cursor, evidenceId: row.evidence_id, runId: row.run_id, pipelineStageId: row.pipeline_stage_id, reason: verdict.reason })
        last = row.cursor
        continue
      }
      if (verdict.disposition === 'held') {
        held.push({ cursor: row.cursor, evidenceId: row.evidence_id, runId: row.run_id, pipelineStageId: row.pipeline_stage_id, reason: verdict.reason })
        last = row.cursor
        continue
      }
      if (verdict.disposition === 'blocked') {
        blocked = { cursor: row.cursor, evidenceId: row.evidence_id, runId: row.run_id, pipelineStageId: row.pipeline_stage_id, reason: verdict.reason }
        break
      }
      try {
        const result = await recordKnowledgeStageReport(stageReportFromEvidenceRow(row, run, step), { db, viewer })
        applied.push({ cursor: row.cursor, evidenceId: row.evidence_id, runId: run.executionRunId, pipelineStageId: row.pipeline_stage_id, status: result.status })
        last = row.cursor
      } catch (error) {
        blocked = { cursor: row.cursor, evidenceId: row.evidence_id, runId: row.run_id, pipelineStageId: row.pipeline_stage_id, reason: `APPLY_FAILED:${error?.status ?? ''}:${error?.message ?? 'unknown'}` }
        break
      }
    }
    // Advance to the page's own watermark only when every row on it is
    // behind us; a block leaves the cursor at the last row that landed.
    cursor = blocked ? last : Math.max(last, page.next_cursor)
    if (cursor !== startCursor || cursorRow === null) {
      await db.knowledgeEvidenceCursor.upsert({
        where: scopeWhere(scope),
        create: { ...scope, cursor, lastPulledAt: now() },
        update: { cursor, lastPulledAt: now() },
      })
    }
    if (page.rows.length < request.limit) break
  }

  return { scope, startCursor, cursor, pages, applied, unattributed, held, blocked }
}
