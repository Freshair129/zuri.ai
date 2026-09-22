import prisma from '@/lib/db'
import { assertProjectRoadmapReadable } from './project-roadmap-read-model'
import { commitBundle } from '../import/bundle/bundle-commit-service'
import {
  ExecutionTraceError,
  createReplayBundle,
  createReplayPlan,
  presentExecutionRun,
  validateReplaySelection,
} from './execution-trace'
import { commitPlan } from '../import/plan-import-service'

// @req FR-069, FR-070 — scope-authorized PM trace read and append-only replay.
// @spec ADR-102, ADR-029, SDD-041, SEC-001, SEC-003, SEC-008
// @tested tests/integration/project-execution-trace.test.js

function projectNotFound() {
  const error = new Error('Project not found')
  error.status = 404
  return error
}

async function loadAuthorizedProject(projectId, { viewer, db }) {
  if (!projectId) throw new Error('projectId is required')
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      business: { select: { id: true, tenantId: true } },
      workspace: { select: { id: true, scopeType: true, businessId: true, tenantId: true, portfolioId: true } },
    },
  })
  if (!project) throw projectNotFound()
  await assertProjectRoadmapReadable(viewer, project, { db })
  return project
}

async function loadRun(projectId, executionRunId, { db }) {
  const run = await db.projectExecutionRun.findFirst({
    where: { executionRunId },
    include: { steps: { orderBy: { sequence: 'asc' } } },
  })
  const projectIds = JSON.parse(run?.projectIdsJson || (run?.projectId ? JSON.stringify([run.projectId]) : '[]'))
  if (!run || (run.projectId !== projectId && !projectIds.includes(projectId))) {
    throw new ExecutionTraceError('TRACE_NOT_FOUND', 'Execution trace not found', 404)
  }
  return run
}

export async function getProjectExecutionTrace(projectId, executionRunId, { viewer, db = prisma } = {}) {
  await loadAuthorizedProject(projectId, { viewer, db })
  const run = await loadRun(projectId, executionRunId, { db })
  return presentExecutionRun(run)
}

export async function replayProjectExecutionTrace(
  projectId,
  executionRunId,
  { viewer, mode = 'full', stepKeys = undefined, db = prisma } = {},
) {
  const project = await loadAuthorizedProject(projectId, { viewer, db })
  const sourceRun = await loadRun(projectId, executionRunId, { db })
  const selected = validateReplaySelection(mode, stepKeys, sourceRun.steps)

  // The shared PM writer currently has one business-effect step. A partial
  // replay that selects only validation/authorization would claim execution
  // without applying a business operation, so refuse it explicitly until a
  // no-op trace-only command is separately specified.
  if (sourceRun.sourceKind !== 'BUNDLE' && selected && !selected.includes('plan.commit')) {
    throw new ExecutionTraceError(
      'TRACE_PARTIAL_STEP_NOT_REPLAYABLE',
      'Partial replay must include plan.commit for the current PM import writer',
    )
  }

  if (sourceRun.sourceKind === 'BUNDLE') {
    const bundleStepKeys = sourceRun.steps.map((step) => step.stepKey)
    if (selected && bundleStepKeys.some((stepKey) => !selected.includes(stepKey))) {
      throw new ExecutionTraceError(
        'TRACE_PARTIAL_BUNDLE_NOT_REPLAYABLE',
        'Partial bundle replay must select every bundle step for the current atomic writer',
      )
    }
    const replayBundle = createReplayBundle(sourceRun, { mode, stepKeys: selected })
    const result = await commitBundle(replayBundle, { viewer, db })
    if (!result.committed || result.replay) {
      return {
        ...result,
        replayOfExecutionRunId: sourceRun.executionRunId,
        mode,
        stepKeys: selected,
      }
    }
    const executionRunId = result.receipt?.bundleRunId
    const trace = executionRunId
      ? await getProjectExecutionTrace(projectId, executionRunId, { viewer, db })
      : null
    return {
      ...result,
      executionRunId,
      replayOfExecutionRunId: sourceRun.executionRunId,
      mode,
      stepKeys: selected,
      trace,
    }
  }

  const replayPlan = createReplayPlan(sourceRun, { mode, stepKeys: selected })
  const replayOfExecutionStepIds = Object.fromEntries(
    sourceRun.steps.map((step) => [step.stepKey, step.executionStepId]),
  )
  const result = await commitPlan(replayPlan, {
    workspaceId: project.workspaceId,
    viewer,
    db,
    traceSourceKind: sourceRun.sourceKind || 'PLAN',
    replayOfExecutionStepIds,
    traceStepKeys: sourceRun.steps.map((step) => step.stepKey),
  })

  if (!result.committed || result.replay) {
    return {
      ...result,
      replayOfExecutionRunId: sourceRun.executionRunId,
      mode,
      stepKeys: selected,
    }
  }

  const trace = await getProjectExecutionTrace(projectId, result.executionRunId, { viewer, db })
  return {
    ...result,
    replayOfExecutionRunId: sourceRun.executionRunId,
    mode,
    stepKeys: selected,
    trace,
  }
}
