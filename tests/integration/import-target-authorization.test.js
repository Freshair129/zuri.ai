import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { dryRunPlan, commitPlan } from '@/modules/project-manager/import/plan-import-service'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-065 — the import pipeline authorizes the Workspace it writes to.
// @spec SDD-037, SEC-001, SEC-002, SEC-008, BR-009
// @tested tests/integration/import-target-authorization.test.js
//
// The three /api/import/* routes took `workspaceId` from the request body and
// resolved no viewer at all. The structural fix in the same review bounded the
// blast radius — a plan can only match rows inside the resolved Workspace — so
// what was left was "choose a Workspace you were not given". This suite is that
// last step, end to end against a real database.
//
// The two properties worth more than the happy path:
//
//   * the target can arrive as `workspaceId` OR as the plan's own
//     `scope.workspaceCode`, and BOTH are authorized. A guard placed in the route
//     handler would have covered only the first, which is the "checked in one
//     representation, used in another" failure this repository keeps repeating.
//   * a refusal is indistinguishable from a Workspace that does not exist, so it
//     cannot be used to enumerate other tenants' ids and codes.

let owned          // Business-scoped Workspace, owned by `owner`
let foreign        // Business-scoped Workspace in another tenant entirely
let abovebusiness  // PORTFOLIO-scoped Workspace — the WS-PLATFORM shape
let owner          // owns `owned`
let intruder       // OWNER globally, and can SEE the foreign Business — but owns it elsewhere

const planFor = (workspaceCode, projectCode) => ({
  schemaVersion: '1.0',
  generatedBy: 'test-agent',
  scope: { workspaceCode },
  project: { code: projectCode, name: 'Authorized Program', status: 'ACTIVE' },
  workstreams: [
    {
      code: `${projectCode}-WST`,
      name: 'Delivery',
      executionMode: 'SOFTWARE_SPRINT',
      progressStrategy: 'TASK_WEIGHT',
      items: [{ code: `${projectCode}-T1`, subtype: 'TASK', title: 'Task 1', status: 'PLANNED', weight: 1 }],
    },
  ],
})

async function scope(suffix) {
  const portfolio = await createPortfolio({ name: `Auth Group ${suffix}`, code: `PF-IMPAUTH-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Auth Tenant ${suffix}`, code: `TNT-IMPAUTH-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Auth Business ${suffix}`, code: `BUS-IMPAUTH-${suffix}` })
  const workspace = await createWorkspace({
    name: `Auth WS ${suffix}`,
    scopeType: 'BUSINESS',
    businessId: business.id,
    code: `WS-IMPAUTH-${suffix}`,
  })
  return { portfolio, tenant, business, workspace }
}

beforeAll(async () => {
  const home = await scope('HOME')
  const other = await scope('OTHER')
  owned = home.workspace
  foreign = other.workspace

  abovebusiness = await createWorkspace({
    name: 'Shared Platform',
    scopeType: 'PORTFOLIO',
    portfolioId: home.portfolio.id,
    code: 'WS-IMPAUTH-PLATFORM',
  })

  owner = makeViewer({
    visibleBusinessIds: [home.business.id],
    ownedBusinessIds: [home.business.id],
  })

  // The shape from the authorization RCAs: globally labelled OWNER, and the
  // target Business is visible — but owned somewhere else entirely.
  intruder = ownsElsewhere({ owns: home.business.id, sees: other.business.id })
})

describe('the owner of the target Business may import', () => {
  it('dry-runs and commits through the plan-scoped path', async () => {
    const plan = planFor('WS-IMPAUTH-HOME', 'PRJ-IMPAUTH-OK')
    const dry = await dryRunPlan(plan, { viewer: owner })
    expect(dry.valid).toBe(true)
    expect(dry.workspace.code).toBe('WS-IMPAUTH-HOME')

    const result = await commitPlan(plan, { viewer: owner })
    expect(result.committed).toBe(true)
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-IMPAUTH-OK' } })).toBeTruthy()
  })

  it('dry-runs through the explicit workspaceId path', async () => {
    const dry = await dryRunPlan(planFor('WS-IMPAUTH-HOME', 'PRJ-IMPAUTH-OK2'), {
      workspaceId: owned.id,
      viewer: owner,
    })
    expect(dry.valid).toBe(true)
  })
})

describe('a viewer who does not own the target is refused — by both routes into it', () => {
  it('refuses an explicit workspaceId naming another tenant', async () => {
    const dry = await dryRunPlan(planFor('WS-IMPAUTH-OTHER', 'PRJ-IMPAUTH-HIJACK'), {
      workspaceId: foreign.id,
      viewer: intruder,
    })
    expect(dry.valid).toBe(false)
    expect(dry.preview).toBeNull()
  })

  it('refuses the plan-supplied scope.workspaceCode naming another tenant', async () => {
    // The path a route-level guard on `workspaceId` would have left wide open:
    // no workspaceId is sent at all, the plan names its own target.
    const dry = await dryRunPlan(planFor('WS-IMPAUTH-OTHER', 'PRJ-IMPAUTH-HIJACK2'), {
      viewer: intruder,
    })
    expect(dry.valid).toBe(false)
    expect(dry.preview).toBeNull()
  })

  it('writes nothing on a refused commit', async () => {
    const before = await prisma.project.count()
    const result = await commitPlan(planFor('WS-IMPAUTH-OTHER', 'PRJ-IMPAUTH-HIJACK3'), {
      workspaceId: foreign.id,
      viewer: intruder,
    })
    expect(result.committed).toBe(false)
    expect(await prisma.project.count()).toBe(before)
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-IMPAUTH-HIJACK3' } })).toBeNull()
  })

  it('CONTROL: the identical plan and target succeed for a viewer who DOES own it', async () => {
    // Without this, every refusal above could be passing for an unrelated reason
    // — a malformed plan, a workspace that never resolved — and the suite would
    // look like it proves authorization while proving nothing.
    const asOwnerOfForeign = makeViewer({
      visibleBusinessIds: [foreign.businessId],
      ownedBusinessIds: [foreign.businessId],
    })
    const result = await commitPlan(planFor('WS-IMPAUTH-OTHER', 'PRJ-IMPAUTH-HIJACK'), {
      workspaceId: foreign.id,
      viewer: asOwnerOfForeign,
    })
    expect(result.committed).toBe(true)
    // Same plan, same target, same code the intruder was refused for: the only
    // thing that changed is the grant.
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-IMPAUTH-HIJACK' } })).toBeTruthy()
  })

  it('refuses a viewer holding no grants at all', async () => {
    const nobody = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [], role: 'MEMBER' })
    const dry = await dryRunPlan(planFor('WS-IMPAUTH-HOME', 'PRJ-IMPAUTH-NOBODY'), { viewer: nobody })
    expect(dry.valid).toBe(false)
  })
})

describe('a refusal is indistinguishable from a Workspace that is not there', () => {
  it('answers a real unowned workspaceId exactly as it answers a fabricated one', async () => {
    const real = await dryRunPlan(planFor('WS-IMPAUTH-OTHER', 'PRJ-IMPAUTH-ORACLE'), {
      workspaceId: foreign.id,
      viewer: intruder,
    })
    const fabricated = await dryRunPlan(planFor('WS-IMPAUTH-OTHER', 'PRJ-IMPAUTH-ORACLE'), {
      workspaceId: 'ws-does-not-exist',
      viewer: intruder,
    })
    // Both messages embed the id the caller supplied — that is their own input
    // echoed back. What must not differ is anything else, or the difference
    // itself tells the caller which ids are real.
    expect(real.errors[0].replace(foreign.id, 'ID')).toBe(
      fabricated.errors[0].replace('ws-does-not-exist', 'ID')
    )
  })

  it('answers a real unowned workspaceCode exactly as it answers a fabricated one', async () => {
    const real = await dryRunPlan(planFor('WS-IMPAUTH-OTHER', 'PRJ-IMPAUTH-ORACLE2'), { viewer: intruder })
    const fabricated = await dryRunPlan(planFor('WS-NOPE-NOT-REAL', 'PRJ-IMPAUTH-ORACLE2'), { viewer: intruder })
    expect(real.errors[0].replace('WS-IMPAUTH-OTHER', 'CODE')).toBe(
      fabricated.errors[0].replace('WS-NOPE-NOT-REAL', 'CODE')
    )
  })
})

describe('a Workspace above Business is refused, and says why', () => {
  it('refuses a PORTFOLIO-scoped target even for a viewer who owns a Business', async () => {
    const dry = await dryRunPlan(planFor('WS-IMPAUTH-PLATFORM', 'PRJ-IMPAUTH-PLATFORM'), { viewer: owner })
    expect(dry.valid).toBe(false)
    expect(dry.errors[0]).toContain('no authority above Business')
    expect(dry.errors[0]).toContain('PORTFOLIO')
  })

  it('refuses the commit and writes nothing', async () => {
    const before = await prisma.project.count()
    const result = await commitPlan(planFor('WS-IMPAUTH-PLATFORM', 'PRJ-IMPAUTH-PLATFORM2'), {
      workspaceId: abovebusiness.id,
      viewer: owner,
    })
    expect(result.committed).toBe(false)
    expect(await prisma.project.count()).toBe(before)
  })
})

describe('forgetting the viewer is a crash, not a quiet write', () => {
  it('throws when the pipeline is called without one', async () => {
    // This is the guard for the NEXT intake surface. `classify()` was given the
    // same treatment for `scope`: the failure mode for omitting the thing that
    // makes the operation safe must be loud at wiring time.
    //
    // It fires once a target actually resolves — a caller who both forgets the
    // viewer and names a nonexistent Workspace gets the ordinary "not found",
    // which is harmless: nothing is written on that path either.
    await expect(
      dryRunPlan(planFor('WS-IMPAUTH-HOME', 'PRJ-IMPAUTH-NOVIEWER'), {})
    ).rejects.toThrow(/viewer is required/i)

    await expect(
      commitPlan(planFor('WS-IMPAUTH-HOME', 'PRJ-IMPAUTH-NOVIEWER'), {})
    ).rejects.toThrow(/viewer is required/i)
  })

  it('leaves nothing behind when it throws', async () => {
    expect(await prisma.project.findUnique({ where: { code: 'PRJ-IMPAUTH-NOVIEWER' } })).toBeNull()
  })
})
