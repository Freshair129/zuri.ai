import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { recordAudit, safeParse } from '@/modules/project-manager/application/audit'
import { isInstallationOperator, seesBusiness } from '@/modules/identity/viewer-authority'
import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
  RUN_STATUSES,
  STEP_STATUSES,
  assertStatusTransition,
  catalogFor,
  hashContractPayload,
  parsePipelineEvent,
  parsePipelineRunInput,
  parseReplayInput,
  stageById,
} from './pipeline-tracking-contract'
import { gateCompliance } from './pipeline-gate-compliance'

// @req FR-071 — full pipeline evidence is written behind one server-owned,
// scope-filtered service boundary with append-only event receipts.
// @req FR-129 — a gate decision's evidence is persisted and returned, and a
// publish that succeeded without a prior approval is reported on the monitor.
// @spec ADR-030 D3-D6, ADR-040 D1-D3, SDD-042, SDD-075, SEC-003, SEC-008
// @tested tests/unit/platform/pipeline-tracking-service.test.js
// @tested tests/unit/platform/fr129-catalog-publication-gate.test.js
// @tested tests/integration/fr129-catalog-publication-gate.test.js

export const PIPELINE_STALE_AFTER_MS = 5 * 60 * 1000

const defaultIdFactory = () => randomUUID()
const resolveNow = (now) => (typeof now === 'function' ? now() : now || new Date())

function serviceError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function requireOperator(viewer) {
  if (!isInstallationOperator(viewer)) throw serviceError(403, 'Pipeline mutation requires an installation operator')
}

function requireVisible(viewer, businessId) {
  if (!isInstallationOperator(viewer) && !seesBusiness(viewer, businessId)) {
    throw serviceError(404, 'Pipeline run is outside your visible Business scope')
  }
}

async function transaction(db, callback) {
  return typeof db.$transaction === 'function' ? db.$transaction(callback) : callback(db)
}

function json(value, fallback) {
  return JSON.stringify(value ?? fallback)
}

function idsForRow(row, field) {
  const value = safeParse(row?.[field], [])
  return Array.isArray(value) ? value : []
}

function refsForRow(row) {
  const refs = safeParse(row?.identityRefsJson, {})
  return refs && typeof refs === 'object' && !Array.isArray(refs) ? refs : { ...IDENTITY_REFS_EMPTY }
}

function runSummary(row, { includeIdentityRefs = false, effectiveStatus = row.status } = {}) {
  return {
    executionRunId: row.executionRunId,
    dataPipelineDefinitionId: row.dataPipelineDefinitionId,
    executionContractId: row.executionContractId,
    tenantId: row.tenantId,
    businessId: row.businessId,
    status: effectiveStatus,
    currentStageId: row.currentStageId || null,
    sourceSha256: row.sourceSha256 || null,
    artifactSha256: row.artifactSha256 || null,
    bootstrapBatchId: row.bootstrapBatchId || null,
    expectedCount: row.expectedCount || 0,
    actualCount: row.actualCount || 0,
    insertedCount: row.insertedCount || 0,
    updatedCount: row.updatedCount || 0,
    unchangedCount: row.unchangedCount || 0,
    failedCount: row.failedCount || 0,
    rejectedCount: row.rejectedCount || 0,
    duplicateCount: row.duplicateCount || 0,
    tagIds: idsForRow(row, 'tagIdsJson'),
    ...(includeIdentityRefs ? { identityRefs: refsForRow(row) } : {}),
    primaryFailureCode: row.primaryFailureCode || null,
    primaryErrorRef: row.primaryErrorRef || null,
    primaryRetryable: row.primaryRetryable ?? null,
    auditEventId: row.auditEventId || null,
    replayScope: row.replayScope || null,
    replayOfExecutionRunId: row.replayOfExecutionRunId || null,
    replayOfExecutionStepId: row.replayOfExecutionStepId || null,
    replayOfPipelineRecordId: row.replayOfPipelineRecordId || null,
    startedAt: row.startedAt || null,
    finishedAt: row.finishedAt || null,
    lastHeartbeatAt: row.lastHeartbeatAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  }
}

function eventSafePayload(event) {
  return {
    eventType: event.eventType,
    dataPipelineDefinitionId: event.dataPipelineDefinitionId,
    executionContractId: event.executionContractId,
    executionRunId: event.executionRunId,
    pipelineStageId: event.pipelineStageId,
    executionStepId: event.executionStepId,
    attemptId: event.attemptId,
    pipelineRecordId: event.pipelineRecordId,
    docId: event.docId,
    picId: event.picId,
    factId: event.factId,
    sourceSha256: event.sourceSha256,
    inputHash: event.inputHash,
    outputHash: event.outputHash,
    status: event.status,
    correlationId: event.correlationId,
    idempotencyKey: event.idempotencyKey,
    tagIds: event.tagIds,
    identityRefs: event.identityRefs,
    failureCode: event.failureCode,
    errorRef: event.errorRef,
    retryable: event.retryable,
  }
}

function stageData(event, step, now) {
  const terminal = ['SUCCEEDED', 'FAILED', 'SKIPPED'].includes(event.status)
  return {
    status: event.status,
    inputHash: event.inputHash,
    outputHash: event.outputHash,
    failureCode: event.failureCode,
    errorRef: event.errorRef,
    retryable: event.retryable,
    tagIdsJson: json(event.tagIds, []),
    identityRefsJson: json(event.identityRefs, IDENTITY_REFS_EMPTY),
    // NFR-020 (SDD-070): only set when the caller actually supplies a count.
    // Omitted on STEP_STARTED/HEARTBEAT, which have nothing to report yet,
    // and on every event from a caller that predates this field — writing
    // undefined here would overwrite an already-recorded count with nothing.
    ...(typeof event.actualCount === 'number' ? { actualCount: event.actualCount } : {}),
    ...(typeof event.insertedCount === 'number' ? { insertedCount: event.insertedCount } : {}),
    ...(typeof event.failedCount === 'number' ? { failedCount: event.failedCount } : {}),
    ...(event.eventType === 'STEP_HEARTBEAT' || event.status === 'RUNNING' ? { lastHeartbeatAt: now } : {}),
    ...(event.status === 'RUNNING' && !step.startedAt ? { startedAt: now } : {}),
    ...(terminal ? { finishedAt: now } : {}),
  }
}

function eventStepStatus(event) {
  if (event.eventType === 'STEP_HEARTBEAT' || event.eventType === 'STEP_STARTED') return 'RUNNING'
  if (event.eventType === 'STEP_SUCCEEDED') return 'SUCCEEDED'
  if (event.eventType === 'STEP_FAILED') return 'FAILED'
  return null
}

function eventRecordStatus(event) {
  if (event.eventType === 'RECORD_STARTED') return 'RUNNING'
  if (event.eventType === 'RECORD_SUCCEEDED') return 'SUCCEEDED'
  if (event.eventType === 'RECORD_FAILED') return 'FAILED'
  return null
}

function stepSummary(row) {
  return {
    executionStepId: row.executionStepId,
    pipelineStageId: row.pipelineStageId,
    sequence: row.sequence,
    attemptId: row.attemptId,
    status: row.status,
    inputHash: row.inputHash || null,
    outputHash: row.outputHash || null,
    expectedCount: row.expectedCount || 0,
    actualCount: row.actualCount || 0,
    insertedCount: row.insertedCount || 0,
    updatedCount: row.updatedCount || 0,
    unchangedCount: row.unchangedCount || 0,
    failedCount: row.failedCount || 0,
    skippedCount: row.skippedCount || 0,
    failureCode: row.failureCode || null,
    errorRef: row.errorRef || null,
    retryable: row.retryable ?? null,
    tagIds: idsForRow(row, 'tagIdsJson'),
    identityRefs: refsForRow(row),
    auditEventId: row.auditEventId || null,
    startedAt: row.startedAt || null,
    finishedAt: row.finishedAt || null,
    lastHeartbeatAt: row.lastHeartbeatAt || null,
  }
}

function recordSummary(row) {
  return {
    pipelineRecordId: row.pipelineRecordId,
    sourceRecordKey: row.sourceRecordKey || null,
    sourceRowNumber: row.sourceRowNumber ?? null,
    sourceSha256: row.sourceSha256 || null,
    docId: row.docId || null,
    picId: row.picId || null,
    factId: row.factId || null,
    sourceDocIds: idsForRow(row, 'sourceDocIdsJson'),
    sourcePicIds: idsForRow(row, 'sourcePicIdsJson'),
    destinationRecordId: row.destinationRecordId || null,
    status: row.status,
    failureCode: row.failureCode || null,
    errorRef: row.errorRef || null,
    retryable: row.retryable ?? null,
    tagIds: idsForRow(row, 'tagIdsJson'),
    identityRefs: refsForRow(row),
    auditEventId: row.auditEventId || null,
    replayOfPipelineRecordId: row.replayOfPipelineRecordId || null,
    occurredAt: row.occurredAt || null,
  }
}

function reconciliationSummary(row) {
  return {
    id: row.id,
    stepId: row.stepId || null,
    expectedCount: row.expectedCount || 0,
    actualCount: row.actualCount || 0,
    insertedCount: row.insertedCount || 0,
    updatedCount: row.updatedCount || 0,
    unchangedCount: row.unchangedCount || 0,
    rejectedCount: row.rejectedCount || 0,
    duplicateCount: row.duplicateCount || 0,
    sourceSha256: row.sourceSha256 || null,
    artifactSha256: row.artifactSha256 || null,
    stagingHash: row.stagingHash || null,
    destinationHash: row.destinationHash || null,
    rlsProbeResult: row.rlsProbeResult || null,
    isolationResult: row.isolationResult || null,
    result: row.result,
    auditEventId: row.auditEventId || null,
    createdAt: row.createdAt || null,
  }
}

function gateSummary(row) {
  return {
    id: row.id,
    gateId: row.gateId || null,
    status: row.status,
    required: row.required !== false,
    decidedByPersonId: row.decidedByPersonId || null,
    reason: row.reason || null,
    // SDD-075 — dropping this field is what made a written evidence column
    // unreachable even once something wrote it. `safeParse` and not `JSON.parse`
    // because the column is untyped text with a DDL default: a row written
    // before this path existed holds `'{}'`, and a row written outside this
    // service could hold anything at all.
    evidence: safeParse(row.evidenceJson, {}),
    auditEventId: row.auditEventId || null,
    createdAt: row.createdAt || null,
  }
}

function latestByStage(steps) {
  const latest = new Map()
  for (const step of steps) {
    const current = latest.get(step.pipelineStageId)
    if (!current || String(step.createdAt || '') >= String(current.createdAt || '')) latest.set(step.pipelineStageId, step)
  }
  return [...latest.values()].sort((left, right) => left.sequence - right.sequence)
}

function maxDate(values) {
  const dates = values.filter(Boolean).map((value) => new Date(value)).filter((value) => !Number.isNaN(value.valueOf()))
  return dates.sort((left, right) => right - left)[0] || null
}

function staleEvidence(run, steps, now, staleAfterMs) {
  const lastHeartbeatAt = maxDate([
    run.lastHeartbeatAt,
    ...steps.map((step) => step.lastHeartbeatAt),
    run.startedAt,
    run.updatedAt,
    run.createdAt,
  ])
  const staleAt = lastHeartbeatAt ? new Date(lastHeartbeatAt.valueOf() + staleAfterMs) : null
  const terminal = !['QUEUED', 'RUNNING'].includes(run.status)
  const stale = !terminal && (!lastHeartbeatAt || now >= staleAt)
  return {
    stale,
    lastHeartbeatAt,
    staleAt,
    reason: stale ? (lastHeartbeatAt ? 'HEARTBEAT_STALE' : 'HEARTBEAT_MISSING') : null,
  }
}

export async function createPipelineRun(input, {
  db = prisma,
  viewer,
  now = () => new Date(),
  idFactory = defaultIdFactory,
} = {}) {
  requireOperator(viewer)
  const value = parsePipelineRunInput(input)
  const requestHash = hashContractPayload(value)
  const at = resolveNow(now)

  return transaction(db, async (tx) => {
    const existing = await tx.pipelineRun.findUnique({ where: { idempotencyKey: value.idempotencyKey } })
    if (existing) {
      if (existing.requestHash !== requestHash) throw serviceError(409, 'Pipeline run idempotency key was reused with different input')
      return { status: 'UNCHANGED', run: runSummary(existing, { includeIdentityRefs: true }) }
    }

    const business = await tx.business.findUnique({
      where: { id: value.businessId },
      select: { id: true, tenantId: true, status: true },
    })
    if (!business || business.status !== 'ACTIVE') throw serviceError(404, 'Pipeline Business not found')

    const run = await tx.pipelineRun.create({
      data: {
        id: idFactory(),
        executionRunId: idFactory(),
        dataPipelineDefinitionId: value.dataPipelineDefinitionId,
        executionContractId: value.executionContractId,
        tenantId: business.tenantId,
        businessId: business.id,
        status: 'QUEUED',
        sourceRef: value.sourceRef,
        sourceSha256: value.sourceSha256,
        artifactRef: value.artifactRef,
        artifactSha256: value.artifactSha256,
        bootstrapBatchId: value.bootstrapBatchId,
        correlationId: value.correlationId,
        idempotencyKey: value.idempotencyKey,
        requestHash,
        expectedCount: value.expectedCount,
        tagIdsJson: json(value.tagIds, []),
        identityRefsJson: json(value.identityRefs, IDENTITY_REFS_EMPTY),
        createdAt: at,
        updatedAt: at,
      },
    })

    // The catalog of the run's OWN definition, not the one this module happened
    // to import — ten DPS-* steps for a Supabase migration, seventeen DPS-KI-*
    // for a knowledge ingestion (SDD-066).
    const catalog = catalogFor(value.dataPipelineDefinitionId)
    for (const stage of catalog) {
      await tx.pipelineStep.create({
        data: {
          id: idFactory(),
          executionStepId: idFactory(),
          runId: run.id,
          pipelineStageId: stage.pipelineStageId,
          sequence: stage.sequence,
          attemptId: idFactory(),
          status: 'NOT_STARTED',
          tagIdsJson: json(value.tagIds, []),
          identityRefsJson: json(value.identityRefs, IDENTITY_REFS_EMPTY),
          createdAt: at,
          updatedAt: at,
        },
      })
    }

    const audit = await recordAudit(tx, {
      entityType: 'PIPELINE_RUN',
      entityId: run.executionRunId,
      action: 'PIPELINE_RUN_CREATED',
      actorType: 'PIPELINE_OPERATOR',
      actorId: viewer?.principal?.id || null,
      payload: {
        dataPipelineDefinitionId: value.dataPipelineDefinitionId,
        executionContractId: value.executionContractId,
        executionRunId: run.executionRunId,
        businessId: business.id,
        correlationId: value.correlationId,
        idempotencyKey: value.idempotencyKey,
        expectedCount: value.expectedCount,
        sourceSha256: value.sourceSha256,
        artifactSha256: value.artifactSha256,
      },
    })
    const updated = await tx.pipelineRun.update({ where: { id: run.id }, data: { auditEventId: audit.id, updatedAt: at } })
    return { status: 'CREATED', run: runSummary(updated, { includeIdentityRefs: true }), stageCount: catalog.length }
  })
}

export async function recordPipelineEvent(input, {
  db = prisma,
  viewer,
  now = () => new Date(),
  idFactory = defaultIdFactory,
} = {}) {
  requireOperator(viewer)
  const event = parsePipelineEvent(input)
  const eventHash = hashContractPayload(event)
  const at = resolveNow(now)

  return transaction(db, async (tx) => {
    const run = await tx.pipelineRun.findUnique({ where: { executionRunId: event.executionRunId } })
    if (!run) throw serviceError(404, 'Pipeline run not found')

    // The envelope validated this event's stage against the event's OWN
    // definition (SDD-066). That is internal consistency, and it is only half of
    // it: an event can be a perfectly formed DPL-KNOWLEDGE-INGEST-V1 envelope
    // and still name a DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1 run, in which case a
    // DPS-KI-EMBED step would be written onto a Supabase run and every check
    // upstream would have passed. Before a second definition existed the two
    // z.literal pins made this impossible by accident; now it has to be said.
    if (event.dataPipelineDefinitionId !== run.dataPipelineDefinitionId
      || event.executionContractId !== run.executionContractId) {
      throw serviceError(409, 'Pipeline event does not belong to the pipeline definition of its run')
    }

    const existingReceipt = await tx.pipelineEventReceipt.findUnique({ where: { idempotencyKey: event.idempotencyKey } })
    if (existingReceipt) {
      if (existingReceipt.eventHash !== eventHash) throw serviceError(409, 'Pipeline event idempotency key was reused with different input')
      return {
        status: 'UNCHANGED',
        receipt: safeParse(existingReceipt.resultJson, {}),
        auditEventId: existingReceipt.auditEventId || null,
      }
    }

    let step = null
    const stepStatus = eventStepStatus(event)
    if (event.executionStepId) {
      step = await tx.pipelineStep.findUnique({ where: { executionStepId: event.executionStepId } })
      if (step && step.runId !== run.id) throw serviceError(409, 'Pipeline step belongs to another run')
      if (!step && stepStatus) {
        const stage = stageById(run.dataPipelineDefinitionId, event.pipelineStageId)
        step = await tx.pipelineStep.create({
          data: {
            id: idFactory(),
            executionStepId: event.executionStepId,
            runId: run.id,
            pipelineStageId: event.pipelineStageId,
            sequence: event.sequence ?? stage?.sequence ?? 0,
            attemptId: event.attemptId,
            status: 'NOT_STARTED',
            createdAt: at,
            updatedAt: at,
          },
        })
      }
      if (step && event.attemptId && step.attemptId !== event.attemptId) {
        throw serviceError(409, 'Pipeline step attempt does not match executionStepId')
      }
    }

    if (stepStatus) {
      assertStatusTransition(step.status, stepStatus, { kind: 'step' })
    }

    const safePayload = eventSafePayload(event)
    const audit = await recordAudit(tx, {
      entityType: event.pipelineRecordId ? 'PIPELINE_RECORD' : event.executionStepId ? 'PIPELINE_STEP' : 'PIPELINE_RUN',
      entityId: event.pipelineRecordId || event.executionStepId || event.executionRunId,
      action: `PIPELINE_${event.eventType}`,
      actorType: 'PIPELINE_OPERATOR',
      actorId: viewer?.principal?.id || null,
      payload: safePayload,
    })

    if (stepStatus && step) {
      step = await tx.pipelineStep.update({
        where: { id: step.id },
        data: { ...stageData(event, step, at), auditEventId: audit.id, updatedAt: at },
      })
    }

    let record = null
    const recordStatus = eventRecordStatus(event)
    if (recordStatus) {
      record = await tx.pipelineRecordEvent.create({
        data: {
          id: idFactory(),
          runId: run.id,
          stepId: step?.id || null,
          attemptId: event.attemptId,
          pipelineRecordId: event.pipelineRecordId,
          sourceRecordKey: event.sourceRecordKey,
          sourceRowNumber: event.sourceRowNumber,
          sourceSha256: event.sourceSha256,
          docId: event.docId,
          picId: event.picId,
          factId: event.factId,
          sourceDocIdsJson: json(event.sourceDocIds, []),
          sourcePicIdsJson: json(event.sourcePicIds, []),
          destinationRecordId: event.destinationRecordId,
          status: recordStatus,
          failureCode: event.failureCode,
          errorRef: event.errorRef,
          retryable: event.retryable,
          tagIdsJson: json(event.tagIds, []),
          identityRefsJson: json(event.identityRefs, IDENTITY_REFS_EMPTY),
          idempotencyKey: event.idempotencyKey,
          auditEventId: audit.id,
          occurredAt: at,
          createdAt: at,
          updatedAt: at,
        },
      })
    }

    let reconciliation = null
    if (event.reconciliation) {
      const value = event.reconciliation
      reconciliation = await tx.pipelineReconciliation.create({
        data: {
          id: idFactory(),
          runId: run.id,
          stepId: step?.id || null,
          ...value,
          evidenceJson: '{}',
          auditEventId: audit.id,
          createdAt: at,
          updatedAt: at,
        },
      })
    }

    let gate = null
    if (event.gate) {
      gate = await tx.pipelineGateDecision.create({
        data: {
          id: idFactory(),
          runId: run.id,
          gateId: event.gate.gateId,
          status: event.gate.status,
          required: event.gate.required,
          decidedByPersonId: event.gate.decidedByPersonId,
          reason: event.gate.reason,
          // SDD-075 — the column has existed since FR-071 and held nothing
          // because this line was the literal `'{}'`. `json()` stringifies the
          // envelope's already-parsed evidence, so what lands in the text
          // column is always valid JSON and always the closed five-member
          // shape `zGateEvidence` admits; a caller that supplies none writes
          // the same `'{}'` it always did.
          evidenceJson: json(event.gate.evidence, {}),
          auditEventId: audit.id,
          createdAt: at,
          updatedAt: at,
        },
      })
    }

    let runStatus = run.status
    if (event.eventType === 'RUN_STARTED' || (stepStatus === 'RUNNING' && run.status === 'QUEUED')) runStatus = 'RUNNING'
    if (event.eventType === 'RUN_FINISHED') {
      assertStatusTransition(run.status, event.status, { kind: 'run' })
      runStatus = event.status
    }
    if (event.status === 'FAILED' && runStatus === 'QUEUED') runStatus = 'RUNNING'

    // NFR-020 (SDD-070). The monitor's execution board has read
    // `run.actualCount` / `run.failedCount` since before this write existed —
    // @default(0), never set by anything, "Failed: 0" rendered in the normal
    // ink a real zero would earn. Only recompute when THIS event actually
    // reported a count; every event that doesn't (the majority) leaves the
    // run's aggregate exactly as the last one that did left it, for the same
    // reason a single step never overwrites its own count with an omitted one.
    const runCounts = (typeof event.actualCount === 'number'
      || typeof event.insertedCount === 'number' || typeof event.failedCount === 'number')
      ? (await tx.pipelineStep.findMany({ where: { runId: run.id } })).reduce((acc, s) => ({
          actualCount: acc.actualCount + (s.actualCount || 0),
          insertedCount: acc.insertedCount + (s.insertedCount || 0),
          failedCount: acc.failedCount + (s.failedCount || 0),
        }), { actualCount: 0, insertedCount: 0, failedCount: 0 })
      : null

    const runUpdate = {
      status: runStatus,
      currentStageId: event.pipelineStageId || run.currentStageId || null,
      lastHeartbeatAt: event.eventType === 'STEP_HEARTBEAT' || event.status === 'RUNNING' ? at : run.lastHeartbeatAt,
      auditEventId: audit.id,
      updatedAt: at,
      ...(event.status === 'RUNNING' && !run.startedAt ? { startedAt: at } : {}),
      ...(RUN_STATUSES.includes(runStatus) && ['SUCCEEDED', 'FAILED', 'PARTIAL', 'ROLLED_BACK', 'CANCELLED'].includes(runStatus) ? { finishedAt: at } : {}),
      ...(event.status === 'FAILED' && !run.primaryFailureCode
        ? { primaryFailureCode: event.failureCode, primaryErrorRef: event.errorRef, primaryRetryable: event.retryable }
        : {}),
      ...(runCounts || {}),
    }
    const updatedRun = await tx.pipelineRun.update({ where: { id: run.id }, data: runUpdate })
    const receiptPayload = {
      executionRunId: updatedRun.executionRunId,
      eventType: event.eventType,
      status: event.status,
      executionStepId: event.executionStepId,
      attemptId: event.attemptId,
      pipelineRecordId: event.pipelineRecordId,
      auditEventId: audit.id,
    }
    const receipt = await tx.pipelineEventReceipt.create({
      data: {
        id: idFactory(),
        runId: run.id,
        idempotencyKey: event.idempotencyKey,
        eventType: event.eventType,
        eventHash,
        resultJson: json(receiptPayload, {}),
        auditEventId: audit.id,
        createdAt: at,
      },
    })

    return {
      status: 'CREATED',
      run: runSummary(updatedRun),
      step: step ? stepSummary(step) : null,
      record: record ? recordSummary(record) : null,
      reconciliation: reconciliation ? reconciliationSummary(reconciliation) : null,
      gate: gate ? gateSummary(gate) : null,
      receipt: safeParse(receipt.resultJson, {}),
      auditEventId: receipt.auditEventId,
    }
  })
}

export async function listPipelineRuns({ businessId = null, status = null, limit = 25, db = prisma, viewer } = {}) {
  if (!businessId && !isInstallationOperator(viewer)) throw serviceError(400, 'businessId is required for a scoped pipeline list')
  if (businessId) requireVisible(viewer, businessId)
  const where = {}
  if (businessId) where.businessId = businessId
  if (status) where.status = status
  const rows = await db.pipelineRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(limit) || 25, 1), 100),
  })
  return {
    runs: rows.map((row) => runSummary(row)),
    count: rows.length,
    limit: Math.min(Math.max(Number(limit) || 25, 1), 100),
  }
}

export async function getPipelineMonitor(executionRunId, {
  db = prisma,
  viewer,
  now = new Date(),
  staleAfterMs = PIPELINE_STALE_AFTER_MS,
} = {}) {
  const run = await db.pipelineRun.findUnique({ where: { executionRunId } })
  if (!run) throw serviceError(404, 'Pipeline run not found')
  requireVisible(viewer, run.businessId)
  const [steps, records, reconciliations, gates] = await Promise.all([
    db.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } }),
    db.pipelineRecordEvent.findMany({ where: { runId: run.id }, orderBy: { occurredAt: 'desc' }, take: 500 }),
    db.pipelineReconciliation.findMany({ where: { runId: run.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.pipelineGateDecision.findMany({ where: { runId: run.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  const at = resolveNow(now)
  const freshness = staleEvidence(run, steps, at, staleAfterMs)
  const selectedSteps = latestByStage(steps)
  const firstFailure = selectedSteps.find((step) => step.status === 'FAILED')
  const stageTimeline = selectedSteps.map((step) => {
    const stage = stageById(run.dataPipelineDefinitionId, step.pipelineStageId)
    const summary = stepSummary(step)
    const durationMs = summary.startedAt && (summary.finishedAt || at)
      ? Math.max(0, new Date(summary.finishedAt || at).valueOf() - new Date(summary.startedAt).valueOf())
      : null
    return { ...summary, label: stage?.label || step.pipelineStageId, durationMs }
  })

  return {
    available: true,
    status: freshness.stale ? 'UNKNOWN' : run.status,
    run: runSummary(run, { includeIdentityRefs: true, effectiveStatus: freshness.stale ? 'UNKNOWN' : run.status }),
    stageTimeline,
    firstFailure: firstFailure ? {
      pipelineStageId: firstFailure.pipelineStageId,
      executionStepId: firstFailure.executionStepId,
      attemptId: firstFailure.attemptId,
      failureCode: firstFailure.failureCode || null,
      errorRef: firstFailure.errorRef || null,
      retryable: firstFailure.retryable ?? null,
    } : null,
    records: records.map(recordSummary),
    failedRecords: records.filter((record) => record.status === 'FAILED').map(recordSummary),
    reconciliations: reconciliations.map(reconciliationSummary),
    reconciliation: reconciliations[0] ? reconciliationSummary(reconciliations[0]) : null,
    gates: gates.map(gateSummary),
    // FR-129 — reported beside `gates` and `steps` because it is a statement
    // ABOUT them, and computed from every step row rather than from
    // `selectedSteps`: `latestByStage` keeps one row per stage, which would
    // hide an unapproved publish behind a later approved retry.
    gateCompliance: gateCompliance({
      dataPipelineDefinitionId: run.dataPipelineDefinitionId,
      steps,
      gates,
    }),
    freshness: {
      stale: freshness.stale,
      reason: freshness.reason,
      lastHeartbeatAt: freshness.lastHeartbeatAt,
      staleAt: freshness.staleAt,
    },
    replay: {
      replayScope: run.replayScope || null,
      replayOfExecutionRunId: run.replayOfExecutionRunId || null,
      replayOfExecutionStepId: run.replayOfExecutionStepId || null,
      replayOfPipelineRecordId: run.replayOfPipelineRecordId || null,
      workerExecution: run.replayScope ? 'PENDING' : null,
    },
  }
}

function matchingRecordRows(rows, value) {
  if (value.scope === 'FAILED_RECORDS') {
    return rows.filter((row) => value.pipelineRecordIds.includes(row.pipelineRecordId) && row.status === 'FAILED')
  }
  if (value.scope === 'PROVENANCE_FILTERED') {
    return rows.filter((row) => (
      (value.docIds.length && (value.docIds.includes(row.docId) || idsForRow(row, 'sourceDocIdsJson').some((id) => value.docIds.includes(id)))) ||
      (value.picIds.length && (value.picIds.includes(row.picId) || idsForRow(row, 'sourcePicIdsJson').some((id) => value.picIds.includes(id)))) ||
      (value.factIds.length && value.factIds.includes(row.factId))
    ))
  }
  return []
}

export async function requestPipelineReplay(executionRunId, input, {
  db = prisma,
  viewer,
  now = () => new Date(),
  idFactory = defaultIdFactory,
} = {}) {
  requireOperator(viewer)
  const value = parseReplayInput(input)
  const requestHash = hashContractPayload({ executionRunId, ...value })
  const at = resolveNow(now)

  return transaction(db, async (tx) => {
    const source = await tx.pipelineRun.findUnique({ where: { executionRunId } })
    if (!source) throw serviceError(404, 'Pipeline run not found')
    const existing = await tx.pipelineRun.findUnique({ where: { idempotencyKey: value.idempotencyKey } })
    if (existing) {
      if (existing.requestHash !== requestHash) throw serviceError(409, 'Replay idempotency key was reused with different input')
      return { status: 'UNCHANGED', run: runSummary(existing), workerExecution: 'PENDING' }
    }
    if (value.sourceSha256 && value.sourceSha256 !== source.sourceSha256) throw serviceError(409, 'Replay source SHA-256 does not match the approved source')
    if (value.artifactSha256 && value.artifactSha256 !== source.artifactSha256) throw serviceError(409, 'Replay artifact SHA-256 does not match the approved artifact')

    const sourceSteps = await tx.pipelineStep.findMany({ where: { runId: source.id }, orderBy: { sequence: 'asc' } })
    const selectedSourceStep = value.executionStepId
      ? sourceSteps.find((step) => step.executionStepId === value.executionStepId)
      : null
    if (value.scope === 'FAILED_STAGE' && (!selectedSourceStep || selectedSourceStep.status !== 'FAILED')) {
      throw serviceError(409, 'Replay stage must resolve to a failed stage in the source run')
    }
    const sourceRecords = (value.scope === 'FAILED_RECORDS' || value.scope === 'PROVENANCE_FILTERED')
      ? await tx.pipelineRecordEvent.findMany({ where: { runId: source.id }, orderBy: { occurredAt: 'desc' }, take: 500 })
      : []
    const selectedRecords = matchingRecordRows(sourceRecords, value)
    if ((value.scope === 'FAILED_RECORDS' || value.scope === 'PROVENANCE_FILTERED') && !selectedRecords.length) {
      throw serviceError(404, 'Replay source records were not found in the authorized run')
    }

    const replay = await tx.pipelineRun.create({
      data: {
        id: idFactory(),
        executionRunId: idFactory(),
        dataPipelineDefinitionId: source.dataPipelineDefinitionId,
        executionContractId: source.executionContractId,
        tenantId: source.tenantId,
        businessId: source.businessId,
        status: 'QUEUED',
        sourceRef: source.sourceRef,
        sourceSha256: source.sourceSha256,
        artifactRef: source.artifactRef,
        artifactSha256: source.artifactSha256,
        bootstrapBatchId: source.bootstrapBatchId,
        correlationId: value.correlationId,
        idempotencyKey: value.idempotencyKey,
        requestHash,
        expectedCount: source.expectedCount || 0,
        tagIdsJson: source.tagIdsJson || '[]',
        identityRefsJson: source.identityRefsJson || '{}',
        replayScope: value.scope,
        replayOfExecutionRunId: source.executionRunId,
        replayOfExecutionStepId: selectedSourceStep?.executionStepId || null,
        replayOfPipelineRecordId: selectedRecords[0]?.pipelineRecordId || null,
        createdAt: at,
        updatedAt: at,
      },
    })

    const newStepBySourceId = new Map()
    for (const sourceStep of sourceSteps) {
      const next = await tx.pipelineStep.create({
        data: {
          id: idFactory(),
          executionStepId: idFactory(),
          runId: replay.id,
          pipelineStageId: sourceStep.pipelineStageId,
          sequence: sourceStep.sequence,
          attemptId: idFactory(),
          status: 'NOT_STARTED',
          tagIdsJson: sourceStep.tagIdsJson || '[]',
          identityRefsJson: sourceStep.identityRefsJson || '{}',
          replayOfExecutionStepId: sourceStep.executionStepId,
          createdAt: at,
          updatedAt: at,
        },
      })
      newStepBySourceId.set(sourceStep.executionStepId, next)
    }

    const selectedTargetStep = selectedSourceStep
      ? newStepBySourceId.get(selectedSourceStep.executionStepId)
      : newStepBySourceId.get(sourceSteps[0]?.executionStepId)
    for (const sourceRecord of selectedRecords) {
      await tx.pipelineRecordEvent.create({
        data: {
          id: idFactory(),
          runId: replay.id,
          stepId: selectedTargetStep?.id || null,
          attemptId: selectedTargetStep?.attemptId || idFactory(),
          pipelineRecordId: sourceRecord.pipelineRecordId,
          sourceRecordKey: sourceRecord.sourceRecordKey,
          sourceRowNumber: sourceRecord.sourceRowNumber,
          sourceSha256: sourceRecord.sourceSha256,
          docId: sourceRecord.docId,
          picId: sourceRecord.picId,
          factId: sourceRecord.factId,
          sourceDocIdsJson: sourceRecord.sourceDocIdsJson || '[]',
          sourcePicIdsJson: sourceRecord.sourcePicIdsJson || '[]',
          destinationRecordId: sourceRecord.destinationRecordId,
          status: 'REPLAYING',
          tagIdsJson: sourceRecord.tagIdsJson || '[]',
          identityRefsJson: sourceRecord.identityRefsJson || '{}',
          idempotencyKey: `replay:${replay.executionRunId}:${sourceRecord.pipelineRecordId}`,
          replayOfPipelineRecordId: sourceRecord.pipelineRecordId,
          occurredAt: at,
          createdAt: at,
          updatedAt: at,
        },
      })
    }

    const audit = await recordAudit(tx, {
      entityType: 'PIPELINE_RUN',
      entityId: replay.executionRunId,
      action: 'PIPELINE_REPLAY_REQUESTED',
      actorType: 'PIPELINE_OPERATOR',
      actorId: viewer?.principal?.id || null,
      payload: {
        executionRunId: replay.executionRunId,
        replayOfExecutionRunId: source.executionRunId,
        replayScope: value.scope,
        replayOfExecutionStepId: selectedSourceStep?.executionStepId || null,
        replayOfPipelineRecordId: selectedRecords[0]?.pipelineRecordId || null,
        correlationId: value.correlationId,
        idempotencyKey: value.idempotencyKey,
        sourceSha256: source.sourceSha256,
        artifactSha256: source.artifactSha256,
      },
    })
    const updated = await tx.pipelineRun.update({ where: { id: replay.id }, data: { auditEventId: audit.id, updatedAt: at } })
    return {
      status: 'CREATED',
      run: runSummary(updated),
      workerExecution: 'PENDING',
      selectedRecordCount: selectedRecords.length,
    }
  })
}

const SOURCE_BUSINESS_TO_ZURI_CODE = Object.freeze({
  smartgift: 'BUS-SMARTGIFT',
})

/**
 * Resolve a source namespace on the server before accepting a worker run.
 * The local outbox never supplies an internal Business or Tenant id.
 */
export async function createPipelineRunFromWorker(input, options = {}) {
  requireOperator(options.viewer)
  const { businessCode, ...runInput } = input || {}
  if (typeof businessCode !== 'string' || !businessCode.trim()) {
    throw serviceError(400, 'Worker businessCode is required')
  }
  const zuriCode = SOURCE_BUSINESS_TO_ZURI_CODE[businessCode.trim().toLowerCase()]
  if (!zuriCode) throw serviceError(400, `Unsupported worker businessCode: ${businessCode}`)
  const db = options.db || prisma
  const business = await db.business.findUnique({
    where: { code: zuriCode },
    select: { id: true, status: true },
  })
  if (!business || business.status !== 'ACTIVE') throw serviceError(404, 'Worker Business target is not active')
  return createPipelineRun({ ...runInput, businessId: business.id }, options)
}

export { DATA_PIPELINE_DEFINITION_ID, EXECUTION_CONTRACT_ID, STEP_STATUSES }
