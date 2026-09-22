import { createHash, randomUUID } from 'node:crypto'
import { recordAudit } from './audit'

// @req FR-069, FR-070 — Project Manager-owned execution run/step/attempt
// identity, failure localization and append-only replay lineage.
// @spec ADR-102, ADR-029, SDD-041, SEC-003, SEC-008
// @tested tests/integration/project-execution-trace.test.js

export const EXECUTION_TRACE_CONTRACT_VERSION = 'project-execution-trace.v1'
export const EXECUTION_TRACE_MAX_SNAPSHOT_BYTES = 256 * 1024
export const LEGACY_EXECUTION_CONTRACT_ID = 'PM-PLAN-LEGACY-V1'

export const PLAN_EXECUTION_STEP_KEYS = Object.freeze([
  'plan.validate',
  'plan.dry_run',
  'plan.authorize',
  'plan.commit',
])

export const MEETING_EXECUTION_STEP_KEYS = Object.freeze([
  'meeting.normalize',
  'meeting.assignment.resolve',
  'plan.commit',
])

export class ExecutionTraceError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message)
    this.name = 'ExecutionTraceError'
    this.code = code
    this.status = status
    if (details !== undefined) this.details = details
  }
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalize(value[key])
        return result
      }, {})
  }
  return value
}

export function normalizedExecutionHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function boundedSnapshot(value) {
  const json = JSON.stringify(canonicalize(value))
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes > EXECUTION_TRACE_MAX_SNAPSHOT_BYTES) {
    throw new ExecutionTraceError(
      'TRACE_INPUT_TOO_LARGE',
      `Execution trace input snapshot exceeds ${EXECUTION_TRACE_MAX_SNAPSHOT_BYTES} bytes`,
      413,
    )
  }
  return { json, hash: createHash('sha256').update(json).digest('hex') }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function traceTagIds(plan) {
  return [...new Set((plan.workstreams || [])
    .flatMap((workstream) => workstream.tagRefs || [])
    .map((tag) => tag.tagId)
    .filter(Boolean))]
}

function scopeValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stepIdentity(stepKey, sequence, replayOfExecutionStepId = null) {
  return {
    id: randomUUID(),
    executionStepId: randomUUID(),
    stepKey,
    sequence,
    attemptId: randomUUID(),
    replayOfExecutionStepId,
  }
}

/**
 * Build IDs and the bounded snapshot before the transaction starts. The IDs
 * are kept so a root transaction failure can be recorded after rollback.
 */
export function createExecutionTraceContext({
  plan,
  workspace,
  sourceKind = 'PLAN',
  executionContractId = null,
  contractVersion = null,
  snapshotValue = plan,
  projectId = null,
  projectIds = [],
  replayOfExecutionRunId = null,
  replayOfExecutionStepId = null,
  replayOfExecutionStepIds = null,
  stepKeys = PLAN_EXECUTION_STEP_KEYS,
} = {}) {
  if (!plan || typeof plan !== 'object') throw new ExecutionTraceError('TRACE_INPUT_INVALID', 'Plan is required')
  const firstWorkstream = plan.workstreams?.[0] || {}
  const planTrace = plan.trace || {}
  const executionRunId = randomUUID()
  const correlationId = planTrace.correlationId || randomUUID()
  const snapshot = boundedSnapshot(snapshotValue)
  const identityRefs = plan.identityRefs || {}
  const replaySourceRun = replayOfExecutionRunId || planTrace.replayOfExecutionRunId || null
  const replaySourceStep = replayOfExecutionStepId || planTrace.replayOfExecutionStepId || null
  const replaySourceSteps = replayOfExecutionStepIds || planTrace.replayOfExecutionStepIds || {}

  return {
    executionRunId,
    executionContractId: executionContractId || firstWorkstream.executionContractId || LEGACY_EXECUTION_CONTRACT_ID,
    contractVersion: contractVersion || firstWorkstream.contractVersion || 'legacy',
    sourceKind,
    tenantId: scopeValue(workspace?.tenantId),
    businessId: scopeValue(workspace?.businessId),
    workspaceId: scopeValue(workspace?.id),
    projectId: scopeValue(projectId),
    projectIdsJson: JSON.stringify(projectIds.filter(Boolean)),
    planId: null,
    status: 'RUNNING',
    correlationId,
    idempotencyKey: scopeValue(planTrace.idempotencyKey),
    requestHash: snapshot.hash,
    inputSnapshotJson: snapshot.json,
    snapshotState: 'RETAINED',
    tagIdsJson: JSON.stringify(traceTagIds(plan)),
    identityRefsJson: JSON.stringify(identityRefs),
    replayOfExecutionRunId: replaySourceRun,
    replayOfExecutionStepId: replaySourceStep,
    steps: stepKeys.map((stepKey, sequence) => stepIdentity(
      stepKey,
      sequence,
      replaySourceSteps[stepKey] || replaySourceStep,
    )),
  }
}

export async function createExecutionTraceRows(tx, context, { stepStatuses = {} } = {}) {
  const run = await tx.projectExecutionRun.create({
    data: {
      id: context.executionRunId,
      executionRunId: context.executionRunId,
      executionContractId: context.executionContractId,
      contractVersion: context.contractVersion,
      sourceKind: context.sourceKind,
      tenantId: context.tenantId,
      businessId: context.businessId,
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      projectIdsJson: context.projectIdsJson,
      planId: context.planId,
      status: context.status,
      correlationId: context.correlationId,
      idempotencyKey: context.idempotencyKey,
      requestHash: context.requestHash,
      inputSnapshotJson: context.inputSnapshotJson,
      snapshotState: context.snapshotState,
      tagIdsJson: context.tagIdsJson,
      identityRefsJson: context.identityRefsJson,
      replayOfExecutionRunId: context.replayOfExecutionRunId,
      replayOfExecutionStepId: context.replayOfExecutionStepId,
    },
  })

  const steps = []
  for (const step of context.steps) {
    steps.push(await tx.projectExecutionStep.create({
      data: {
        id: step.id,
        executionStepId: step.executionStepId,
        runId: run.id,
        executionContractId: context.executionContractId,
        stepKey: step.stepKey,
        sequence: step.sequence,
        attemptId: step.attemptId,
        status: stepStatuses[step.stepKey] || 'NOT_STARTED',
        tenantId: context.tenantId,
        businessId: context.businessId,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        planId: context.planId,
        tagIdsJson: context.tagIdsJson,
        identityRefsJson: context.identityRefsJson,
        replayOfExecutionStepId: step.replayOfExecutionStepId,
        ...(stepStatuses[step.stepKey] === 'SUCCEEDED'
          ? { startedAt: new Date(), finishedAt: new Date() }
          : {}),
      },
    }))
  }
  return { run, steps }
}

export async function finishExecutionStep(tx, executionStepId, {
  status,
  projectId = null,
  planId = null,
  inputHash = null,
  outputHash = null,
  failureCode = null,
  errorRef = null,
  retryable = null,
  skippedReason = null,
  auditEventId = null,
} = {}) {
  return tx.projectExecutionStep.update({
    where: { executionStepId },
    data: {
      status,
      projectId,
      planId,
      inputHash,
      outputHash,
      failureCode,
      errorRef,
      retryable,
      skippedReason,
      auditEventId,
      startedAt: { set: new Date() },
      finishedAt: { set: new Date() },
    },
  })
}

export async function finishExecutionRun(tx, executionRunId, {
  status,
  projectId = null,
  projectIds = undefined,
  planId = null,
  auditEventId = null,
  failureCode = null,
  errorRef = null,
  retryable = null,
} = {}) {
  return tx.projectExecutionRun.update({
    where: { executionRunId },
    data: {
      status,
      projectId,
      ...(projectIds ? { projectIdsJson: JSON.stringify(projectIds.filter(Boolean)) } : {}),
      planId,
      auditEventId,
      failureCode,
      errorRef,
      retryable,
      finishedAt: new Date(),
    },
  })
}

export async function recordExecutionStepAudit(tx, {
  context,
  step,
  entityId,
  planId = null,
  status = 'SUCCEEDED',
  outputHash = null,
  failureCode = null,
  errorRef = null,
  retryable = null,
  skippedReason = null,
  actorType = 'AGENT_PLAN',
}) {
  const auditEvent = await recordAudit(tx, {
    entityType: entityId ? 'PROJECT' : 'EXECUTION_RUN',
    entityId: entityId || context.executionRunId,
    action: status === 'SUCCEEDED'
      ? 'EXECUTION_STEP_SUCCEEDED'
      : status === 'SKIPPED'
        ? 'EXECUTION_STEP_SKIPPED'
        : 'EXECUTION_STEP_FAILED',
    actorType,
    tenantId: context.tenantId,
    businessId: context.businessId,
    payload: {
      executionRunId: context.executionRunId,
      executionStepId: step.executionStepId,
      attemptId: step.attemptId,
      stepKey: step.stepKey,
      status,
      outputHash,
      failureCode,
      errorRef,
      retryable,
      skippedReason,
    },
  })
  await finishExecutionStep(tx, step.executionStepId, {
    status,
    projectId: entityId,
    planId,
    inputHash: context.requestHash,
    outputHash,
    failureCode,
    errorRef,
    retryable,
    skippedReason,
    auditEventId: auditEvent.id,
  })
  return auditEvent
}

function safeErrorRef(error) {
  const code = error?.code || error?.name || 'UNKNOWN_ERROR'
  return String(code).slice(0, 128)
}

/**
 * Persist the failed run after the business transaction has rolled back. This
 * is intentionally called only with the root Prisma client; a bundle's outer
 * transaction must own its own rollback and cannot persist a nested failure.
 */
export async function recordFailedExecutionTrace(db, context, error, { failedStepKey = 'plan.commit' } = {}) {
  const failureCode = 'PM_EXECUTION_TRANSACTION_FAILED'
  const errorRef = safeErrorRef(error)
  const failedContextStep = context.steps.find((step) => step.stepKey === failedStepKey) || context.steps.at(-1)
  const { steps } = await createExecutionTraceRows(db, context, {
    stepStatuses: Object.fromEntries(context.steps.map((step) => [
      step.stepKey,
      step.stepKey === failedContextStep.stepKey
        ? 'FAILED'
        : (step.sequence < failedContextStep.sequence ? 'SUCCEEDED' : 'NOT_STARTED'),
    ])),
  })
  const failedStep = steps.find((step) => step.stepKey === failedContextStep.stepKey) || steps.at(-1)
  const auditEvent = await recordExecutionStepAudit(db, {
    context,
    step: context.steps.find((step) => step.executionStepId === failedStep.executionStepId) || context.steps.at(-1),
    entityId: context.projectId,
    status: 'FAILED',
    failureCode,
    errorRef,
    retryable: true,
  })
  await finishExecutionRun(db, context.executionRunId, {
    status: 'FAILED',
    projectId: context.projectId,
    auditEventId: auditEvent.id,
    failureCode,
    errorRef,
    retryable: true,
  })
  return { executionRunId: context.executionRunId, auditEventId: auditEvent.id }
}

export function parseExecutionSnapshot(run) {
  const snapshot = parseJson(run?.inputSnapshotJson, null)
  if (!snapshot) throw new ExecutionTraceError('TRACE_SNAPSHOT_INVALID', 'Execution trace snapshot is invalid', 409)
  if (normalizedExecutionHash(snapshot) !== run.requestHash) {
    throw new ExecutionTraceError('TRACE_SNAPSHOT_HASH_MISMATCH', 'Execution trace snapshot hash does not match the source run', 409)
  }
  return snapshot
}

export function validateReplaySelection(mode, stepKeys, sourceSteps = []) {
  if (mode !== 'full' && mode !== 'partial') {
    throw new ExecutionTraceError('TRACE_REPLAY_MODE_INVALID', 'Replay mode must be "full" or "partial"')
  }
  if (mode === 'full') return null
  if (!Array.isArray(stepKeys) || stepKeys.length === 0) {
    throw new ExecutionTraceError('TRACE_REPLAY_STEPS_REQUIRED', 'Partial replay requires at least one stepKey')
  }
  const known = new Set(sourceSteps.map((step) => step.stepKey))
  const invalid = stepKeys.filter((key) => !known.has(key))
  if (invalid.length > 0) {
    throw new ExecutionTraceError('TRACE_REPLAY_STEP_UNKNOWN', 'Partial replay contains an unknown stepKey', 400, invalid)
  }
  return [...new Set(stepKeys)]
}

export function createReplayPlan(sourceRun, { mode, stepKeys } = {}) {
  const sourcePlan = parseExecutionSnapshot(sourceRun)
  const selected = mode === 'partial' ? stepKeys : null
  const sourceTrace = { ...(sourcePlan.trace || {}) }
  delete sourceTrace.replayStepKeys
  return {
    ...sourcePlan,
    schemaVersion: '1.2',
    trace: {
      ...sourceTrace,
      correlationId: randomUUID(),
      idempotencyKey: `pm-replay-${randomUUID()}`,
      replayOfExecutionRunId: sourceRun.executionRunId,
      replayOfExecutionStepId: selected?.length === 1
        ? sourceRun.steps?.find((step) => step.stepKey === selected[0])?.executionStepId || null
        : null,
      ...(selected ? { replayStepKeys: selected } : {}),
    },
  }
}

export function createReplayBundle(sourceRun, { mode, stepKeys } = {}) {
  const sourceBundle = parseExecutionSnapshot(sourceRun)
  const selected = mode === 'partial' ? stepKeys : null
  const sourceStepId = selected?.length === 1
    ? sourceRun.steps?.find((step) => step.stepKey === selected[0])?.executionStepId || null
    : null
  const sourceTrace = { ...(sourceBundle.trace || {}) }
  delete sourceTrace.replayOfBundleRunId
  delete sourceTrace.replayOfBundleStepId
  return {
    ...sourceBundle,
    trace: {
      ...sourceTrace,
      correlationId: randomUUID(),
      idempotencyKey: `pm-replay-${randomUUID()}`,
      replayOfBundleRunId: sourceRun.executionRunId,
      ...(sourceStepId ? { replayOfBundleStepId: sourceStepId } : {}),
    },
    projects: sourceBundle.projects.map((entry) => ({
      ...entry,
      plan: {
        ...entry.plan,
        trace: {
          ...(entry.plan.trace || {}),
          correlationId: randomUUID(),
          idempotencyKey: `pm-replay-${randomUUID()}`,
          replayOfExecutionRunId: sourceRun.executionRunId,
          replayOfExecutionStepId: sourceStepId,
        },
      },
    })),
  }
}

function presentStep(step) {
  return {
    executionStepId: step.executionStepId,
    stepKey: step.stepKey,
    sequence: step.sequence,
    attemptId: step.attemptId,
    status: step.status,
    projectId: step.projectId,
    planId: step.planId,
    containerId: step.containerId,
    workItemId: step.workItemId,
    inputHash: step.inputHash,
    outputHash: step.outputHash,
    tagIds: parseJson(step.tagIdsJson, []),
    identityRefs: parseJson(step.identityRefsJson, {}),
    failureCode: step.failureCode,
    errorRef: step.errorRef,
    retryable: step.retryable,
    skippedReason: step.skippedReason,
    auditEventId: step.auditEventId,
    replayOfExecutionStepId: step.replayOfExecutionStepId,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
  }
}

export function presentExecutionRun(run) {
  return {
    executionRunId: run.executionRunId,
    executionContractId: run.executionContractId,
    contractVersion: run.contractVersion,
    traceContractVersion: EXECUTION_TRACE_CONTRACT_VERSION,
    sourceKind: run.sourceKind,
    tenantId: run.tenantId,
    businessId: run.businessId,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    projectIds: parseJson(run.projectIdsJson, run.projectId ? [run.projectId] : []),
    planId: run.planId,
    status: run.status,
    correlationId: run.correlationId,
    idempotencyKey: run.idempotencyKey,
    requestHash: run.requestHash,
    snapshotState: run.snapshotState,
    tagIds: parseJson(run.tagIdsJson, []),
    identityRefs: parseJson(run.identityRefsJson, {}),
    failureCode: run.failureCode,
    errorRef: run.errorRef,
    retryable: run.retryable,
    auditEventId: run.auditEventId,
    replayOfExecutionRunId: run.replayOfExecutionRunId,
    replayOfExecutionStepId: run.replayOfExecutionStepId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    steps: [...(run.steps || [])].sort((a, b) => a.sequence - b.sequence).map(presentStep),
  }
}
