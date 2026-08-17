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

describe('plan envelope import', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Import Group', code: 'PF-IMP' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Import Tenant', code: 'TNT-IMP' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Import Business', code: 'BUS-IMP' })
    workspace = await createWorkspace({ name: 'Import WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-IMP' })
    viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
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
      include: { workstreams: true, milestones: true, gates: true, repositories: true },
    })
    expect(project.workstreams.length).toBe(2)
    expect(project.milestones.length).toBe(1)
    expect(project.gates.length).toBe(1)
    expect(project.repositories.length).toBe(1)
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
})
