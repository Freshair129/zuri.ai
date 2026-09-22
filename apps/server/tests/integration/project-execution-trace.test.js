import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import {
  createBusiness,
  createPortfolio,
  createTenant,
  createWorkspace,
} from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { commitPlan } from '@/modules/project-manager/import/plan-import-service'
import {
  getProjectExecutionTrace,
  replayProjectExecutionTrace,
} from '@/modules/project-manager/application/project-execution-trace-service'

// @req FR-069, FR-070 — PM execution trace, failure/replay lineage and
// compatibility receipt linkage.
// @spec ADR-102, ADR-029, SDD-041, SEC-001, SEC-003, SEC-008
// @tested tests/integration/project-execution-trace.test.js

let workspace
let viewer
let plan

describe('Project Manager execution trace and replay', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Trace Group', code: 'PF-TRACE' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Trace Tenant', code: 'TNT-TRACE' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Trace Business', code: 'BUS-TRACE' })
    workspace = await createWorkspace({
      name: 'Trace Workspace',
      scopeType: 'BUSINESS',
      businessId: business.id,
      code: 'WS-TRACE',
    })
    viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    plan = {
      schemaVersion: '1.2',
      generatedBy: 'trace-test',
      scope: { workspaceCode: workspace.code },
      project: { code: 'PRJ-TRACE', name: 'Trace Project', status: 'ACTIVE' },
      trace: { correlationId: 'corr-trace-1', idempotencyKey: 'idem-trace-1' },
      domainBinding: {
        primaryDomainId: 'DOM-DEVELOPMENT',
        supportingDomainIds: [],
        technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
      },
      identityRefs: {},
      workstreams: [{
        code: 'WST-TRACE',
        name: 'Trace workstream',
        executionMode: 'SOFTWARE_SPRINT',
        executionModeId: 'EXM-SOFTWARE-SPRINT',
        executionContractId: 'EXC-SOFTWARE-SPRINT-V1',
        contractVersion: '1.0.0',
        progressStrategy: 'TASK_WEIGHT',
        items: [{ code: 'TRACE-TASK', subtype: 'TASK', title: 'Trace task' }],
      }],
    }
  })

  it('persists an ordered run/step/attempt graph and keeps the receipt compatible', async () => {
    const result = await commitPlan(plan, { viewer })
    expect(result.committed).toBe(true)

    const run = await prisma.projectExecutionRun.findUnique({
      where: { executionRunId: result.executionRunId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    })
    expect(run).toMatchObject({
      executionRunId: result.executionRunId,
      status: 'SUCCEEDED',
      executionContractId: 'EXC-SOFTWARE-SPRINT-V1',
      projectId: result.projectId,
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(run.steps.map((step) => step.stepKey)).toEqual([
      'plan.validate',
      'plan.dry_run',
      'plan.authorize',
      'plan.commit',
    ])
    expect(run.steps.every((step) => step.status === 'SUCCEEDED')).toBe(true)
    expect(new Set(run.steps.map((step) => step.attemptId)).size).toBe(4)
    expect(run.steps.every((step) => step.auditEventId)).toBe(true)

    const receipt = await prisma.planImportReceipt.findUnique({
      where: { idempotencyKey: plan.trace.idempotencyKey },
    })
    expect(receipt).toMatchObject({
      executionRunId: result.executionRunId,
      stepKey: 'plan.import.commit',
      executionStepId: run.steps[3].executionStepId,
      auditEventId: result.auditEventId,
    })
  })

  it('returns the scoped trace and refuses a viewer outside the Business', async () => {
    const project = await prisma.project.findUnique({ where: { code: 'PRJ-TRACE' } })
    const source = await prisma.projectExecutionRun.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
    })
    const result = await getProjectExecutionTrace(
      project.id,
      source.executionRunId,
      { viewer },
    )
    expect(result.steps).toHaveLength(4)
    expect(result.steps[3]).toMatchObject({ stepKey: 'plan.commit', status: 'SUCCEEDED' })

    await expect(getProjectExecutionTrace(
      result.projectId,
      result.executionRunId,
      { viewer: ownsElsewhere({ owns: 'business-other', sees: 'business-other' }) },
    )).rejects.toMatchObject({ status: 404 })
  })

  it('replays with new run/step IDs and source lineage without changing the source run', async () => {
    const source = await prisma.projectExecutionRun.findFirst({
      where: { projectId: (await prisma.project.findUnique({ where: { code: 'PRJ-TRACE' } })).id },
      include: { steps: true },
      orderBy: { createdAt: 'asc' },
    })
    const sourceSnapshot = { executionRunId: source.executionRunId, status: source.status, updatedAt: source.updatedAt }

    const full = await replayProjectExecutionTrace(source.projectId, source.executionRunId, { viewer, mode: 'full' })
    expect(full.committed).toBe(true)
    expect(full.executionRunId).not.toBe(source.executionRunId)
    expect(full.replayOfExecutionRunId).toBe(source.executionRunId)
    expect(full.trace).toMatchObject({
      executionRunId: full.executionRunId,
      replayOfExecutionRunId: source.executionRunId,
      status: 'SUCCEEDED',
    })
    expect(full.trace.steps.map((step) => step.replayOfExecutionStepId)).toEqual(
      [...source.steps].sort((a, b) => a.sequence - b.sequence).map((step) => step.executionStepId),
    )

    const partial = await replayProjectExecutionTrace(source.projectId, source.executionRunId, {
      viewer,
      mode: 'partial',
      stepKeys: ['plan.commit'],
    })
    expect(partial.committed).toBe(true)
    expect(partial.trace.replayOfExecutionRunId).toBe(source.executionRunId)
    expect(partial.trace.replayOfExecutionStepId).toBe(source.steps.find((step) => step.stepKey === 'plan.commit').executionStepId)
    expect(partial.trace.steps.filter((step) => step.stepKey !== 'plan.commit').every((step) => (
      step.status === 'SKIPPED' && step.skippedReason === 'PARTIAL_REPLAY_NOT_SELECTED'
    ))).toBe(true)

    const unchanged = await prisma.projectExecutionRun.findUnique({ where: { executionRunId: source.executionRunId } })
    expect({ executionRunId: unchanged.executionRunId, status: unchanged.status, updatedAt: unchanged.updatedAt })
      .toEqual(sourceSnapshot)
  })

  it('does not create a second effect for the original idempotency key', async () => {
    const before = await prisma.projectExecutionRun.count({ where: { idempotencyKey: plan.trace.idempotencyKey } })
    const retry = await commitPlan(plan, { viewer })
    expect(retry).toMatchObject({ committed: true, replay: true })
    expect(await prisma.projectExecutionRun.count({ where: { idempotencyKey: plan.trace.idempotencyKey } })).toBe(before)
  })
})
