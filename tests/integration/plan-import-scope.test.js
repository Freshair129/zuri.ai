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

// @req FR-012, FR-019 — import child entities must be scoped to the plan's
// target workspace/project/workstream by construction, not matched by a
// globally-unique `code` and judged afterward.
// Regression coverage for pm-triage-2026-08-17.md S2 / pm-r3-intake.md F1:
// classify() previously ran extraConflictCheck for `project` and
// `workstream` only — workContainer, workItem, milestone and gate were
// matched by a database-wide `findUnique({ where: { code } })` with no
// ownership check at all, so a plan naming another workspace's (or
// tenant's) code was classified as a routine "update" and overwritten it
// on commit.

let workspaceA
let workspaceB

// @req FR-065 — the pipeline authorizes its target, so it takes a viewer. This
// suite proves child entities are scoped by construction, which is a *different*
// guarantee from authorization: it deliberately runs as a viewer who owns BOTH
// Businesses, so every refusal it observes is scoping, never a missing grant.
let viewer
const dryRun = (plan, opts = {}) => dryRunPlan(plan, { viewer, ...opts })
const runCommit = (plan, opts = {}) => commitPlan(plan, { viewer, ...opts })

async function makeScope(suffix) {
  const portfolio = await createPortfolio({ name: `Scope Group ${suffix}`, code: `PF-SCOPEBUG-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Scope Tenant ${suffix}`, code: `TNT-SCOPEBUG-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Scope Business ${suffix}`, code: `BUS-SCOPEBUG-${suffix}` })
  return createWorkspace({ name: `Scope WS ${suffix}`, scopeType: 'BUSINESS', businessId: business.id, code: `WS-SCOPEBUG-${suffix}` })
}

describe('import child-entity scoping (cross-workspace / cross-tenant hijack)', () => {
  beforeAll(async () => {
    // Two fully separate tenants — A and B never share a portfolio, tenant
    // or business. Only their codes will collide, on purpose.
    workspaceA = await makeScope('A')
    workspaceB = await makeScope('B')
    const businesses = [workspaceA.businessId, workspaceB.businessId]
    viewer = makeViewer({ visibleBusinessIds: businesses, ownedBusinessIds: businesses })

    const planA = {
      schemaVersion: '1.1',
      generatedBy: 'test-agent',
      scope: { workspaceCode: 'WS-SCOPEBUG-A' },
      project: { code: 'PRJ-SCOPEBUG-A', name: 'Alpha Program', status: 'ACTIVE' },
      workstreams: [
        {
          code: 'WST-SCOPEBUG-A',
          name: 'Alpha Dev',
          executionMode: 'SOFTWARE_SPRINT',
          progressStrategy: 'TASK_WEIGHT',
          items: [
            {
              code: 'ITEM-SCOPEBUG-SHARED',
              subtype: 'TASK',
              title: 'Alpha original title',
              status: 'IN_PROGRESS',
              weight: 3,
              externalRefs: [{ system: 'SCOPEBUG', id: 'ALPHA-ITEM-1' }],
            },
          ],
        },
      ],
    }

    const seed = await runCommit(planA)
    expect(seed.committed).toBe(true)
  })

  it('RED-PROOF / F1: a plan targeting workspace B must not match, preview as "update", or overwrite workspace A\'s item by its globally-unique code', async () => {
    const planB = {
      schemaVersion: '1.0',
      generatedBy: 'attacker-agent',
      scope: { workspaceCode: 'WS-SCOPEBUG-B' },
      project: { code: 'PRJ-SCOPEBUG-B', name: 'Beta Program', status: 'ACTIVE' },
      workstreams: [
        {
          code: 'WST-SCOPEBUG-B',
          name: 'Beta Dev',
          executionMode: 'SOFTWARE_SPRINT',
          progressStrategy: 'TASK_WEIGHT',
          items: [
            {
              // Same code as an item that belongs to project ALPHA in a
              // different tenant's workspace. Nothing in this envelope
              // references workspace A, project ALPHA or its workstream.
              code: 'ITEM-SCOPEBUG-SHARED',
              subtype: 'TASK',
              title: 'Beta hijack title',
              status: 'DONE',
              weight: 99,
            },
          ],
        },
      ],
    }

    const before = await prisma.workItem.findUnique({ where: { code: 'ITEM-SCOPEBUG-SHARED' } })
    expect(before).toBeTruthy()
    expect(before.title).toBe('Alpha original title')

    const dry = await dryRun(planB)
    // The preview must not lie: this is not a benign update of Beta's own
    // item (Beta has none yet) — it is a collision with Alpha's item.
    expect(dry.valid).toBe(false)
    expect(dry.preview.conflicts.some((c) => c.kind === 'item' && c.code === 'ITEM-SCOPEBUG-SHARED')).toBe(true)
    expect(dry.preview.updates.some((u) => u.code === 'ITEM-SCOPEBUG-SHARED')).toBe(false)

    const commit = await runCommit(planB)
    expect(commit.committed).toBe(false)

    const after = await prisma.workItem.findUnique({ where: { code: 'ITEM-SCOPEBUG-SHARED' } })
    expect(after.title).toBe('Alpha original title')
    expect(after.weight).toBe(3)
    expect(after.workstreamId).toBe(before.workstreamId)
  })

  it('F1 (workstream variant): a plan whose project is a fresh insert must not silently claim an existing workstream code from another project', async () => {
    // Workspace B again, but a brand-new project code this time — the
    // buggy `existingProject && ...` guard skipped the workstream
    // ownership check whenever the project itself was an insert.
    const planB2 = {
      schemaVersion: '1.0',
      project: { code: 'PRJ-SCOPEBUG-B2', name: 'Beta Program 2', status: 'ACTIVE' },
      workstreams: [
        {
          // Same code as Alpha's workstream, which belongs to project ALPHA
          // in a completely different tenant.
          code: 'WST-SCOPEBUG-A',
          name: 'Hijacked name',
          executionMode: 'OPERATIONS',
          progressStrategy: 'SLA_SCORE',
        },
      ],
    }

    const dry = await dryRun(planB2, { workspaceId: workspaceB.id })
    expect(dry.valid).toBe(false)
    expect(dry.preview.conflicts.some((c) => c.kind === 'workstream' && c.code === 'WST-SCOPEBUG-A')).toBe(true)

    const commit = await runCommit(planB2, { workspaceId: workspaceB.id })
    expect(commit.committed).toBe(false)

    const alphaWorkstream = await prisma.workstream.findUnique({ where: { code: 'WST-SCOPEBUG-A' } })
    expect(alphaWorkstream.name).toBe('Alpha Dev')
    expect(alphaWorkstream.executionMode).toBe('SOFTWARE_SPRINT')
  })

  it('legitimate in-scope update still classifies as an update and commits', async () => {
    const planA2 = {
      schemaVersion: '1.0',
      scope: { workspaceCode: 'WS-SCOPEBUG-A' },
      project: { code: 'PRJ-SCOPEBUG-A', name: 'Alpha Program', status: 'ACTIVE' },
      workstreams: [
        {
          code: 'WST-SCOPEBUG-A',
          name: 'Alpha Dev',
          executionMode: 'SOFTWARE_SPRINT',
          progressStrategy: 'TASK_WEIGHT',
          items: [
            {
              code: 'ITEM-SCOPEBUG-SHARED',
              subtype: 'TASK',
              title: 'Alpha updated title',
              status: 'IN_PROGRESS',
              weight: 5,
            },
          ],
        },
      ],
    }

    const dry = await dryRun(planA2)
    expect(dry.valid).toBe(true)
    expect(dry.preview.updates.some((u) => u.kind === 'item' && u.code === 'ITEM-SCOPEBUG-SHARED')).toBe(true)
    expect(dry.preview.conflicts.length).toBe(0)

    const commit = await runCommit(planA2)
    expect(commit.committed).toBe(true)

    const item = await prisma.workItem.findUnique({ where: { code: 'ITEM-SCOPEBUG-SHARED' } })
    expect(item.title).toBe('Alpha updated title')
    expect(item.weight).toBe(5)
  })

  it('external-ref relabel path still works within scope (FR-019)', async () => {
    const relabel = {
      schemaVersion: '1.1',
      scope: { workspaceCode: 'WS-SCOPEBUG-A' },
      project: { code: 'PRJ-SCOPEBUG-A', name: 'Alpha Program', status: 'ACTIVE' },
      workstreams: [
        {
          code: 'WST-SCOPEBUG-A',
          name: 'Alpha Dev',
          executionMode: 'SOFTWARE_SPRINT',
          progressStrategy: 'TASK_WEIGHT',
          items: [
            {
              // A new code, but the same external id already mapped to the
              // Alpha item — this should relabel that record in place.
              code: 'ITEM-SCOPEBUG-RENAMED',
              subtype: 'TASK',
              title: 'Alpha renamed via external id',
              externalRefs: [{ system: 'SCOPEBUG', id: 'ALPHA-ITEM-1' }],
            },
          ],
        },
      ],
    }

    const dry = await dryRun(relabel)
    expect(dry.valid).toBe(true)
    const updateRow = dry.preview.updates.find((u) => u.matchedBy === 'externalRef' && u.planCode === 'ITEM-SCOPEBUG-RENAMED')
    expect(updateRow).toBeTruthy()
    expect(updateRow.code).toBe('ITEM-SCOPEBUG-SHARED') // our code namespace still wins

    const commit = await runCommit(relabel)
    expect(commit.committed).toBe(true)

    const item = await prisma.workItem.findUnique({ where: { code: 'ITEM-SCOPEBUG-SHARED' } })
    expect(item.title).toBe('Alpha renamed via external id')
    expect(await prisma.workItem.findUnique({ where: { code: 'ITEM-SCOPEBUG-RENAMED' } })).toBeNull()
  })

  it('external-ref match cannot be used to bypass scoping: an id mapped to an out-of-scope record is a conflict, not a cross-workspace update', async () => {
    // Workspace B tries to "relabel" Alpha's item by reusing its external
    // id from inside a Beta-scoped workstream. Same external id, wrong
    // scope — the match must still be rejected.
    const crossScopeRelabel = {
      schemaVersion: '1.1',
      project: { code: 'PRJ-SCOPEBUG-B3', name: 'Beta Program 3', status: 'ACTIVE' },
      workstreams: [
        {
          code: 'WST-SCOPEBUG-B3',
          name: 'Beta Dev 3',
          executionMode: 'SOFTWARE_SPRINT',
          progressStrategy: 'TASK_WEIGHT',
          items: [
            {
              code: 'ITEM-SCOPEBUG-STEAL',
              subtype: 'TASK',
              title: 'Stolen via external id',
              externalRefs: [{ system: 'SCOPEBUG', id: 'ALPHA-ITEM-1' }],
            },
          ],
        },
      ],
    }

    const dry = await dryRun(crossScopeRelabel, { workspaceId: workspaceB.id })
    expect(dry.valid).toBe(false)
    expect(dry.preview.conflicts.some((c) => c.kind === 'item' && c.code === 'ITEM-SCOPEBUG-STEAL')).toBe(true)

    const commit = await runCommit(crossScopeRelabel, { workspaceId: workspaceB.id })
    expect(commit.committed).toBe(false)

    const item = await prisma.workItem.findUnique({ where: { code: 'ITEM-SCOPEBUG-SHARED' } })
    expect(item.title).toBe('Alpha renamed via external id') // untouched by the Beta attempt
  })
})
