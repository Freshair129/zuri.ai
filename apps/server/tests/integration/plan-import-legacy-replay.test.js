// @req FR-065, FR-069 — legacy full-plan submissions replay without overwriting later edits
// @spec ADR-102; BR-007; SDD-039; SEC-008
// @tested tests/integration/plan-import-legacy-replay.test.js

import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { persistImportViewer } from '../helpers/persist-import-viewer'
import {
  commitPlan,
  deriveLegacyPlanReplayIdentity,
  dryRunPlan,
} from '@/modules/project-manager/import/plan-import-service'

let workspace, otherWorkspace, business, owner, secondOwner

function planFor({
  schemaVersion = '1.0',
  workspaceCode = workspace.code,
  projectCode,
  taskTitle = 'Imported task',
  correlationId,
  idempotencyKey,
} = {}) {
  const sprintCode = `${projectCode}-SPRINT`
  const workstream = {
    code: `${projectCode}-WST`,
    name: 'Delivery',
    executionMode: 'SOFTWARE_SPRINT',
    progressStrategy: 'TASK_WEIGHT',
    progressWeight: 1,
    containers: [{ code: sprintCode, subtype: 'SPRINT', title: 'Sprint 1', status: 'ACTIVE' }],
    items: [{
      code: `${projectCode}-TASK`,
      containerCode: sprintCode,
      subtype: 'TASK',
      title: taskTitle,
      status: 'IN_PROGRESS',
      weight: 1,
    }],
    milestones: [],
    gates: [],
  }
  const plan = {
    schemaVersion,
    generatedBy: 'legacy-replay-test',
    scope: { workspaceCode },
    project: {
      code: projectCode,
      name: `Imported ${projectCode}`,
      description: 'Plan import legacy replay fixture',
      type: 'TRANSFORMATION',
      status: 'ACTIVE',
    },
    workstreams: [workstream],
    repositories: [],
    dependencies: [],
  }

  if (correlationId || idempotencyKey) {
    plan.trace = {
      ...(correlationId ? { correlationId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    }
  }

  if (schemaVersion === '1.2') {
    plan.trace = { correlationId, idempotencyKey }
    plan.domainBinding = {
      primaryDomainId: 'DOM-DEVELOPMENT',
      supportingDomainIds: [],
      technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
    }
    plan.identityRefs = {}
    workstream.executionModeId = 'EXM-SOFTWARE-SPRINT'
    workstream.executionContractId = 'EXC-SOFTWARE-SPRINT-V1'
    workstream.contractVersion = '1.0.0'
  }

  return plan
}

function runCommit(plan, viewer = owner, workspaceId) {
  return commitPlan(plan, { viewer, ...(workspaceId ? { workspaceId } : {}) })
}

async function receiptsForProject(projectId) {
  return prisma.planImportReceipt.findMany({ where: { projectId } })
}

describe('legacy full-plan idempotency', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Legacy Replay Group', code: 'PF-C11' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Legacy Replay Tenant', code: 'TNT-C11' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Legacy Replay Business', code: 'BUS-C11' })
    workspace = await createWorkspace({
      name: 'Legacy Replay Space',
      scopeType: 'BUSINESS',
      businessId: business.id,
      code: 'WS-C11-A',
    })
    otherWorkspace = await createWorkspace({
      name: 'Other Legacy Replay Space',
      scopeType: 'BUSINESS',
      businessId: business.id,
      code: 'WS-C11-B',
    })

    owner = await persistImportViewer(makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
    }))
    secondOwner = await persistImportViewer(makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      principal: { id: 'per-c11-second', code: 'PER-C11-SECOND', displayName: 'Second plan owner' },
    }))
  })

  it('replays an identical 1.0 plan with its original run and audit receipt and no new writes', async () => {
    const plan = planFor({ projectCode: 'PRJ-C11-SAME' })
    const first = await runCommit(plan)
    expect(first.committed).toBe(true)
    expect(first.replay).not.toBe(true)

    const runsBeforeReplay = await prisma.projectExecutionRun.count({ where: { projectId: first.projectId } })
    const auditsBeforeReplay = await prisma.auditEvent.count({
      where: { action: 'PLAN_IMPORTED', entityId: first.projectId },
    })
    expect(runsBeforeReplay).toBe(1)
    expect(auditsBeforeReplay).toBe(1)
    const replay = await runCommit(plan)

    expect(replay).toMatchObject({
      committed: true,
      replay: true,
      executionRunId: first.executionRunId,
      auditEventId: first.auditEventId,
    })
    expect(await prisma.projectExecutionRun.count({ where: { projectId: first.projectId } })).toBe(runsBeforeReplay)
    expect(await prisma.auditEvent.count({
      where: { action: 'PLAN_IMPORTED', entityId: first.projectId },
    })).toBe(auditsBeforeReplay)

    const receipts = await receiptsForProject(first.projectId)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ schemaVersion: '1.0' })
    expect(receipts[0].idempotencyKey).toMatch(/^zai-legacy-plan:v1:[0-9a-f]{64}$/)
    expect(receipts[0].payloadHash).toBe(receipts[0].idempotencyKey.slice('zai-legacy-plan:v1:'.length))
  })

  it('does not overwrite a project edit made after the first 1.0 submission', async () => {
    const plan = planFor({ projectCode: 'PRJ-C11-EDIT' })
    const first = await runCommit(plan)
    const editedName = 'Name edited after import'
    await prisma.project.update({ where: { id: first.projectId }, data: { name: editedName } })

    const replay = await runCommit(plan)

    expect(replay).toMatchObject({ committed: true, replay: true, executionRunId: first.executionRunId })
    await expect(prisma.project.findUnique({ where: { id: first.projectId } }))
      .resolves.toMatchObject({ name: editedName })
  })

  it('replays an identical 1.1 plan using one versioned legacy receipt', async () => {
    const plan = planFor({ schemaVersion: '1.1', projectCode: 'PRJ-C11-V11' })
    const first = await runCommit(plan)
    const replay = await runCommit(plan)

    expect(replay).toMatchObject({ committed: true, replay: true, executionRunId: first.executionRunId })
    const receipts = await receiptsForProject(first.projectId)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ schemaVersion: '1.1' })
    expect(receipts[0].idempotencyKey).toMatch(/^zai-legacy-plan:v1:[0-9a-f]{64}$/)
  })

  it('treats changed plan content as a new submission and applies the task update', async () => {
    const firstPlan = planFor({ projectCode: 'PRJ-C11-CONTENT', taskTitle: 'First task title' })
    const first = await runCommit(firstPlan)
    const changedPlan = structuredClone(firstPlan)
    changedPlan.workstreams[0].items[0].title = 'Changed task title'

    const changed = await runCommit(changedPlan)

    expect(changed.committed).toBe(true)
    expect(changed.replay).not.toBe(true)
    expect(changed.executionRunId).not.toBe(first.executionRunId)
    await expect(prisma.workItem.findUnique({ where: { code: 'PRJ-C11-CONTENT-TASK' } }))
      .resolves.toMatchObject({ title: 'Changed task title' })
    const receipts = await receiptsForProject(first.projectId)
    expect(receipts).toHaveLength(2)
    expect(new Set(receipts.map((receipt) => receipt.idempotencyKey)).size).toBe(2)
  })

  it('ignores trace.correlationId and trace.idempotencyKey when deriving a 1.0 replay key', async () => {
    const firstPlan = planFor({ projectCode: 'PRJ-C11-CORRELATION', correlationId: 'correlation-first', idempotencyKey: 'caller-key-first' })
    const first = await runCommit(firstPlan)
    const secondPlan = structuredClone(firstPlan)
    secondPlan.trace.correlationId = 'correlation-second'
    secondPlan.trace.idempotencyKey = 'caller-key-second'

    const replay = await runCommit(secondPlan)

    expect(replay).toMatchObject({ committed: true, replay: true, executionRunId: first.executionRunId })
    expect(await receiptsForProject(first.projectId)).toHaveLength(1)
  })

  it('replays when correlation metadata is the only trace difference', async () => {
    const firstPlan = planFor({ projectCode: 'PRJ-C11-TRACE-ABSENT-FIRST' })
    const first = await runCommit(firstPlan)
    const secondPlan = structuredClone(firstPlan)
    secondPlan.trace = { correlationId: 'correlation-only-on-replay' }

    const replay = await runCommit(secondPlan)

    expect(replay).toMatchObject({ committed: true, replay: true, executionRunId: first.executionRunId })
    expect(await receiptsForProject(first.projectId)).toHaveLength(1)
  })

  it('replays when a correlation-only trace becomes absent', async () => {
    const firstPlan = planFor({
      projectCode: 'PRJ-C11-TRACE-ABSENT-SECOND',
      correlationId: 'correlation-only-on-first-submit',
    })
    const first = await runCommit(firstPlan)
    const secondPlan = structuredClone(firstPlan)
    delete secondPlan.trace

    const replay = await runCommit(secondPlan)

    expect(replay).toMatchObject({ committed: true, replay: true, executionRunId: first.executionRunId })
    expect(await receiptsForProject(first.projectId)).toHaveLength(1)
  })

  it('keeps semantically meaningful trace fields in the legacy replay identity', () => {
    const plan = planFor({ projectCode: 'PRJ-C11-TRACE-SEMANTIC' })
    const withReplayLineage = structuredClone(plan)
    withReplayLineage.trace = { replayOfExecutionRunId: 'prior-run-meaning' }

    const base = deriveLegacyPlanReplayIdentity({ plan, workspaceId: workspace.id, actor: 'owner-c11' })
    const lineage = deriveLegacyPlanReplayIdentity({ plan: withReplayLineage, workspaceId: workspace.id, actor: 'owner-c11' })

    expect(lineage.idempotencyKey).not.toBe(base.idempotencyKey)
  })

  it('uses a distinct legacy receipt for a different actor on the same workspace', async () => {
    const plan = planFor({ projectCode: 'PRJ-C11-ACTOR' })
    const first = await runCommit(plan, owner)
    const second = await runCommit(plan, secondOwner)

    expect(second.committed).toBe(true)
    expect(second.replay).not.toBe(true)
    expect(second.executionRunId).not.toBe(first.executionRunId)
    const receipts = await receiptsForProject(first.projectId)
    expect(receipts).toHaveLength(2)
    expect(new Set(receipts.map((receipt) => receipt.idempotencyKey)).size).toBe(2)
  })

  it('uses distinct legacy receipts when the same-shaped plan targets another workspace', async () => {
    const firstPlan = planFor({ projectCode: 'PRJ-C11-SPACE-A', workspaceCode: workspace.code })
    const secondPlan = planFor({ projectCode: 'PRJ-C11-SPACE-B', workspaceCode: otherWorkspace.code })
    const first = await runCommit(firstPlan)
    const second = await runCommit(secondPlan)

    expect(second.committed).toBe(true)
    expect(second.replay).not.toBe(true)
    expect(second.projectId).not.toBe(first.projectId)
    const receipts = [
      ...(await receiptsForProject(first.projectId)),
      ...(await receiptsForProject(second.projectId)),
    ]
    expect(receipts).toHaveLength(2)
    expect(new Set(receipts.map((receipt) => receipt.idempotencyKey)).size).toBe(2)
  })

  it('does not replay identical plan content into another workspace when its project code is out of scope', async () => {
    const plan = planFor({ projectCode: 'PRJ-C11-WORKSPACE-SAME' })
    delete plan.scope
    const first = await runCommit(plan, owner, workspace.id)
    expect(first.committed).toBe(true)

    const refused = await runCommit(plan, owner, otherWorkspace.id)

    expect(refused.committed).toBe(false)
    expect(refused.replay).not.toBe(true)
    expect(refused.errors.join(' ')).toMatch(/different workspace/i)
    expect(await receiptsForProject(first.projectId)).toHaveLength(1)
  })

  it('keeps a schema 1.2 idempotency key verbatim', async () => {
    const key = 'idem-c11-schema-12-verbatim'
    const plan = planFor({
      schemaVersion: '1.2',
      projectCode: 'PRJ-C11-V12',
      correlationId: 'correlation-v12',
      idempotencyKey: key,
    })
    const result = await runCommit(plan)
    const receipt = await prisma.planImportReceipt.findUnique({ where: { idempotencyKey: key } })

    expect(result.committed).toBe(true)
    expect(receipt).toMatchObject({ idempotencyKey: key, schemaVersion: '1.2' })
    expect(receipt.idempotencyKey).not.toMatch(/^zai-legacy-plan:/)
  })

  it('refuses a schema 1.2 caller key in the reserved legacy prefix on dry-run and commit', async () => {
    const key = `zai-legacy-plan:v1:${'a'.repeat(64)}`
    const plan = planFor({
      schemaVersion: '1.2',
      projectCode: 'PRJ-C11-RESERVED-KEY',
      correlationId: 'correlation-reserved-key',
      idempotencyKey: key,
    })

    const dryRun = await dryRunPlan(plan, { viewer: owner })
    const commit = await runCommit(plan)

    expect(dryRun.valid).toBe(false)
    expect(dryRun.errors.join('\n')).toContain('trace.idempotencyKey uses the reserved prefix zai-legacy-plan:')
    expect(commit.committed).toBe(false)
    expect(commit.errors.join('\n')).toContain('trace.idempotencyKey uses the reserved prefix zai-legacy-plan:')
    await expect(prisma.planImportReceipt.findUnique({ where: { idempotencyKey: key } })).resolves.toBeNull()
    await expect(prisma.project.findUnique({ where: { code: plan.project.code } })).resolves.toBeNull()
  })
})
