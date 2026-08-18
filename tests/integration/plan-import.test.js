import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { makeViewer } from '../factories/viewer'

let workspace
let viewer
let businessGoal

// @req FR-065 — import authorizes its target, so the pipeline now takes a viewer.
// This suite is about validation, diffing and transactional commit, not about
// authorization: it runs as the owner of the Business it creates. The
// authorization behaviour itself is pinned in
// tests/integration/import-target-authorization.test.js.
const dryRun = (plan, opts = {}) => dryRunPlan(plan, { viewer, ...opts })
const runCommit = (plan, opts = {}) => commitPlan(plan, { viewer, ...opts })

const plan = {
  schemaVersion: '1.0',
  generatedBy: 'test-agent',
  scope: { workspaceCode: 'WS-IMP' },
  project: {
    code: 'PRJ-IMP',
    name: 'Imported Program',
    description: 'via plan envelope',
    type: 'TRANSFORMATION',
    status: 'ACTIVE',
  },
  workstreams: [
    {
      code: 'WST-IMP-DEV',
      name: 'Dev',
      executionMode: 'SOFTWARE_SPRINT',
      progressStrategy: 'TASK_WEIGHT',
      progressWeight: 1.2,
      containers: [{ code: 'IMP-SPR-1', subtype: 'SPRINT', title: 'Sprint 1', status: 'ACTIVE' }],
      items: [
        { code: 'IMP-T1', containerCode: 'IMP-SPR-1', subtype: 'TASK', title: 'Task 1', status: 'IN_PROGRESS', weight: 5 },
      ],
      milestones: [{ code: 'IMP-MS1', title: 'Milestone 1' }],
      gates: [{ code: 'IMP-GATE1', title: 'Gate 1', required: true }],
    },
    {
      code: 'WST-IMP-MIG',
      name: 'Migration',
      executionMode: 'DATA_MIGRATION',
      progressStrategy: 'RECORD_VALIDATION',
      items: [
        {
          code: 'IMP-DS1',
          subtype: 'DATASET',
          title: 'Dataset',
          metrics: { recordsTotal: 100, validated: 30 },
        },
      ],
    },
  ],
  repositories: [{ code: 'REP-IMP', provider: 'github', fullName: 'org/imported', role: 'REFERENCE' }],
  dependencies: [{ sourceRef: 'IMP-GATE1', targetRef: 'WST-IMP-DEV', type: 'RELATES_TO' }],
}

function schema12Plan() {
  const candidate = structuredClone(plan)
  candidate.schemaVersion = '1.2'
  candidate.project.code = 'PRJ-IMP-V12'
  candidate.project.name = 'Imported Program v1.2'
  candidate.trace = {
    correlationId: 'corr-plan-import-v12',
    idempotencyKey: 'idem-plan-import-v12',
  }
  candidate.domainBinding = {
    primaryDomainId: 'DOM-DEVELOPMENT',
    supportingDomainIds: [],
    technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
  }
  candidate.identityRefs = {}
  candidate.workstreams = candidate.workstreams.map((workstream) => {
    const prefix = `V12-${workstream.code}`
    const containerCodes = new Map((workstream.containers || []).map((container) => [container.code, `V12-${container.code}`]))
    return {
      ...workstream,
      code: prefix,
      containers: (workstream.containers || []).map((container) => ({
        ...container,
        code: `V12-${container.code}`,
        parentCode: container.parentCode ? `V12-${container.parentCode}` : undefined,
      })),
      items: (workstream.items || []).map((item) => ({
        ...item,
        code: `V12-${item.code}`,
        containerCode: item.containerCode ? containerCodes.get(item.containerCode) : undefined,
      })),
      milestones: (workstream.milestones || []).map((milestone) => ({ ...milestone, code: `V12-${milestone.code}` })),
      gates: (workstream.gates || []).map((gate) => ({ ...gate, code: `V12-${gate.code}` })),
    }
  })
  candidate.repositories = [{ ...candidate.repositories[0], code: 'REP-IMP-V12' }]
  candidate.dependencies = [{ sourceRef: 'V12-IMP-GATE1', targetRef: 'V12-WST-IMP-DEV', type: 'RELATES_TO' }]
  return candidate
}

describe('plan envelope import', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Import Group', code: 'PF-IMP' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Import Tenant', code: 'TNT-IMP' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Import Business', code: 'BUS-IMP' })
    workspace = await createWorkspace({ name: 'Import WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-IMP' })
    viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    businessGoal = await prisma.businessGoal.create({
      data: {
        businessId: business.id,
        code: 'GOAL-IMP',
        title: 'Imported Business Goal',
        status: 'ACTIVE',
        priority: 'HIGH',
        progress: 25,
      },
    })
    plan.project.goalIds = [businessGoal.id]
  })

  it('rejects unknown execution mode at validation', async () => {
    const bad = structuredClone(plan)
    bad.workstreams[0].executionMode = 'CHAOS_MODE'
    const result = await dryRun(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/executionMode/i)
  })

  it('rejects malformed references', async () => {
    const bad = structuredClone(plan)
    bad.dependencies = [{ sourceRef: 'MISSING', targetRef: 'WST-IMP-DEV', type: 'BLOCKS' }]
    const result = await dryRun(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/MISSING/)
  })

  it('dry-run previews inserts without writing', async () => {
    const before = await prisma.project.count()
    const result = await dryRun(plan)
    expect(result.valid).toBe(true)
    expect(result.workspace.code).toBe('WS-IMP')
    expect(result.preview.summary.insertCount).toBeGreaterThan(0)
    expect(result.preview.summary.conflictCount).toBe(0)
    const after = await prisma.project.count()
    expect(after).toBe(before) // no writes
  })

  it('commit is transactional and audited', async () => {
    const result = await runCommit(plan)
    expect(result.committed).toBe(true)
    const project = await prisma.project.findUnique({
      where: { code: 'PRJ-IMP' },
      include: { workstreams: true, milestones: true, gates: true, repositories: true, goalLinks: { include: { goal: true } } },
    })
    expect(project.workstreams.length).toBe(2)
    expect(project.milestones.length).toBe(1)
    expect(project.gates.length).toBe(1)
    expect(project.repositories.length).toBe(1)
    expect(project.goalLinks.map((link) => link.goal.code)).toEqual(['GOAL-IMP'])
    expect(project.businessId).toBe(workspace.businessId)
    const dep = await prisma.dependency.findFirst({ where: { dependencyType: 'RELATES_TO' } })
    expect(dep).toBeTruthy()
    const audit = await prisma.auditEvent.findFirst({
      where: { action: 'PLAN_IMPORTED', entityId: project.id },
    })
    expect(audit).toBeTruthy()
    expect(audit.actorType).toBe('AGENT_PLAN')
  })

  it('re-import classifies as updates, not conflicts (idempotent upsert)', async () => {
    const result = await dryRun(plan)
    expect(result.valid).toBe(true)
    expect(result.preview.summary.updateCount).toBeGreaterThan(0)
    const commit2 = await runCommit(plan)
    expect(commit2.committed).toBe(true)
    const count = await prisma.workstream.count({ where: { code: 'WST-IMP-DEV' } })
    expect(count).toBe(1)
  })

  it('conflicts block commit: same project code in another workspace', async () => {
    const otherWs = await createWorkspace({
      name: 'Other WS',
      scopeType: 'BUSINESS',
      businessId: (await prisma.business.findUnique({ where: { code: 'BUS-IMP' } })).id,
      code: 'WS-IMP-2',
    })
    const conflicted = structuredClone(plan)
    conflicted.scope.workspaceCode = 'WS-IMP-2'
    const result = await dryRun(conflicted)
    expect(result.valid).toBe(false)
    expect(result.preview.conflicts.length).toBeGreaterThan(0)
    const blocked = await runCommit(conflicted)
    expect(blocked.committed).toBe(false)
  })

  it('rejects plan without resolvable workspace', async () => {
    const orphan = structuredClone(plan)
    orphan.scope = { workspaceCode: 'WS-DOES-NOT-EXIST' }
    const result = await dryRun(orphan)
    expect(result.valid).toBe(false)
  })

  it('persists schema 1.2 identity, receipt, deterministic hash and audit trace', async () => {
    const v12 = schema12Plan()
    const result = await runCommit(v12)
    expect(result.committed).toBe(true)
    expect(result.executionRunId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(result.executionStepId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(result.attemptId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(result.stepKey).toBe('plan.import.commit')
    expect(result.status).toBe('SUCCEEDED')
    expect(result.auditEventId).toMatch(/^[0-9a-f-]{36}$/i)

    const project = await prisma.project.findUnique({
      where: { code: 'PRJ-IMP-V12' },
      include: { workstreams: true },
    })
    const workstream = project.workstreams.find((row) => row.code === 'V12-WST-IMP-DEV')
    expect(workstream).toMatchObject({
      executionModeId: 'EXM-SOFTWARE-SPRINT',
      executionContractId: 'EXC-SOFTWARE-SPRINT-V1',
      contractVersion: '1.0.0',
      primaryDomainId: 'DOM-DEVELOPMENT',
      technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
    })
    expect(JSON.parse(workstream.supportingDomainIdsJson)).toEqual([])
    expect(JSON.parse(workstream.identityRefsJson)).toEqual(expect.objectContaining({ gateIds: [], artifactIds: [] }))

    const receipt = await prisma.planImportReceipt.findUnique({ where: { idempotencyKey: v12.trace.idempotencyKey } })
    expect(receipt).toMatchObject({
      correlationId: v12.trace.correlationId,
      schemaVersion: '1.2',
      projectId: project.id,
      executionRunId: result.executionRunId,
      executionStepId: result.executionStepId,
      attemptId: result.attemptId,
      stepKey: 'plan.import.commit',
      status: 'SUCCEEDED',
      auditEventId: result.auditEventId,
    })
    expect(receipt.payloadHash).toMatch(/^[0-9a-f]{64}$/)

    const audit = await prisma.auditEvent.findFirst({
      where: { action: 'PLAN_IMPORTED', entityId: project.id },
    })
    const auditPayload = JSON.parse(audit.payloadJson)
    expect(auditPayload).toMatchObject({
      correlationId: v12.trace.correlationId,
      idempotencyKey: v12.trace.idempotencyKey,
      executionRunId: result.executionRunId,
    })
  })

  it('retries the same idempotency key without writes and returns the original result', async () => {
    const v12 = schema12Plan()
    const first = await runCommit(v12)
    const beforeAuditCount = await prisma.auditEvent.count({ where: { action: 'PLAN_IMPORTED' } })
    const beforeWorkstream = await prisma.workstream.findUnique({ where: { code: 'V12-WST-IMP-DEV' } })

    const retry = await runCommit(v12)
    expect(retry).toEqual(first)
    expect(await prisma.auditEvent.count({ where: { action: 'PLAN_IMPORTED' } })).toBe(beforeAuditCount)
    expect((await prisma.workstream.findUnique({ where: { code: 'V12-WST-IMP-DEV' } })).version).toBe(beforeWorkstream.version)
  })

  it('rejects a different payload under an existing idempotency key without writes', async () => {
    const v12 = schema12Plan()
    await runCommit(v12)
    const beforeAuditCount = await prisma.auditEvent.count({ where: { action: 'PLAN_IMPORTED' } })
    const changed = structuredClone(v12)
    changed.project.description = 'different payload'

    const result = await runCommit(changed)
    expect(result.committed).toBe(false)
    expect(result.errors.join(' ')).toMatch(/idempotency/i)
    expect(await prisma.auditEvent.count({ where: { action: 'PLAN_IMPORTED' } })).toBe(beforeAuditCount)
    expect(await prisma.planImportReceipt.count({ where: { idempotencyKey: v12.trace.idempotencyKey } })).toBe(1)
  })
})
