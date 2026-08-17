// @req FR-059 - OWNER-scoped Business Strategy mutation: Roadmap/horizons,
// Goal, and Goal<->Project link/unlink, through audited project-manager services.
// @spec SDD-032, BR-001, SEC-003
// Goal<->Project isolation mirrors the project-ownership rule FR-043 enforces
// for direct Project ownership; this suite does not itself implement FR-043.
// @tested tests/integration/fr059-business-strategy-mutation.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { createProject } from '@/modules/project-manager/application/project-service'
import {
  createRoadmap,
  updateRoadmap,
  createGoal,
  updateGoal,
  linkProjectToGoal,
  unlinkProjectFromGoal,
} from '@/modules/project-manager/application/business-strategy-mutation-service'
import { GET as getBusinessStrategyRoute } from '@/app/api/business/strategy/route'
import { POST as postRoadmapRoute } from '@/app/api/business/roadmaps/route'
import { PATCH as patchRoadmapRoute } from '@/app/api/business/roadmaps/[id]/route'
import { POST as postGoalRoute } from '@/app/api/business/goals/route'
import { PATCH as patchGoalRoute } from '@/app/api/business/goals/[id]/route'
import { POST as postGoalProjectRoute } from '@/app/api/business/goals/[id]/projects/route'
import { DELETE as deleteGoalProjectRoute } from '@/app/api/business/goals/[id]/projects/[projectId]/route'
import { LOCAL_DEMO_COOKIE } from '@/modules/identity/session-port'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

// Repaid from docs/.viewer-fixture-baseline.json on 2026-08-17: every viewer
// in this suite now comes from tests/factories/viewer.js, so it carries every
// field resolveViewer emits and obeys its invariants. The hand-built versions
// (role 'OWNER' with no ownedBusinessIds at all) are what let the FR-059/T3b-1
// hole ship green — see
// .brain/rca/2026-08-16-global-role-is-not-per-business-authority.md.
//
// visibleBusinessIds/ownedBusinessIds are populated once businessA/B/control
// exist (see beforeAll below) — BLOCKER 1 (visibleBusinessIds) and T3b-1
// FIX 1 (ownedBusinessIds) both made these load-bearing fields: without
// ownedBusinessIds in particular, every write this OWNER makes to any of the
// fixture Businesses would now be refused by assertBusinessOwned, since this
// fixture models an OWNER who genuinely owns every Business it visibly uses.
let OWNER
// No ownedBusinessIds passed, so makeViewer infers role 'MEMBER' — the same
// inference resolveViewer itself does (OWNER only when something is owned).
const MEMBER = makeViewer({ principal: { id: 'fr059-member' } })

const twoHorizons = [
  { key: 'SHORT', label: 'Short term', position: 1 },
  { key: 'MEDIUM', label: 'Medium term', position: 2 },
]

function auditFor(entityType, entityId, action) {
  return prisma.auditEvent.findFirst({
    where: { entityType, entityId, action },
    orderBy: { occurredAt: 'desc' },
  })
}

// resolveRequestViewer's local-demo path falls back to this well-known code
// (src/modules/identity/resolve-viewer.js LOCAL_OWNER_CODE) and resolves as
// OWNER with visibleBusinessIds = every Business in the test database (the
// dev fallback branch), so it is usable for the route-level happy-path tests
// below without needing to scope it to particular fixture Businesses.
const LOCAL_OWNER_CODE = 'PER-OWNER'

async function ensureLocalDemoOwner() {
  process.env.ZURI_LOCAL_DEMO_AUTH = '1'
  await prisma.person.upsert({
    where: { code: LOCAL_OWNER_CODE },
    update: {},
    create: { code: LOCAL_OWNER_CODE, displayName: 'Local Owner' },
  })
}

function demoRequest(url, { method = 'GET', body } = {}) {
  return new Request(url, {
    method,
    headers: {
      cookie: `${LOCAL_DEMO_COOKIE}=enabled`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

async function fetchStrategy(businessId) {
  await ensureLocalDemoOwner()
  const res = await getBusinessStrategyRoute(demoRequest(`http://local/api/business/strategy?businessId=${businessId}`))
  expect(res.status).toBe(200)
  return res.json()
}

describe('FR-059 Business Strategy mutation', () => {
  let businessA
  let businessB
  let projectA
  let projectB
  let sharedProject
  let controlBusiness

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `FR059 ${suffix}`, code: `PF-F59-${suffix}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `FR059 A ${suffix}`, code: `TNT-F59A-${suffix}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `FR059 B ${suffix}`, code: `TNT-F59B-${suffix}` })
    businessA = await createBusiness({ tenantId: tenantA.id, name: `FR059 A ${suffix}`, code: `BUS-F59A-${suffix}` })
    businessB = await createBusiness({ tenantId: tenantB.id, name: `FR059 B ${suffix}`, code: `BUS-F59B-${suffix}` })
    controlBusiness = await createBusiness({ tenantId: tenantA.id, name: `FR059 Control ${suffix}`, code: `BUS-F59C-${suffix}` })
    OWNER = makeViewer({
      principal: { id: 'fr059-owner' },
      visibleBusinessIds: [businessA.id, businessB.id, controlBusiness.id],
      ownedBusinessIds: [businessA.id, businessB.id, controlBusiness.id],
    })

    const wsA = await createWorkspace({ name: `FR059 A ${suffix}`, scopeType: 'BUSINESS', businessId: businessA.id, code: `WS-F59A-${suffix}` })
    const wsB = await createWorkspace({ name: `FR059 B ${suffix}`, scopeType: 'BUSINESS', businessId: businessB.id, code: `WS-F59B-${suffix}` })
    const wsShared = await createWorkspace({ name: `FR059 Shared ${suffix}`, scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: `WS-F59S-${suffix}` })

    projectA = await createProject({ workspaceId: wsA.id, name: `FR059 Project A ${suffix}`, code: `PRJ-F59A-${suffix}` }, { viewer: OWNER })
    projectB = await createProject({ workspaceId: wsB.id, name: `FR059 Project B ${suffix}`, code: `PRJ-F59B-${suffix}` }, { viewer: OWNER })
    // FR-072(b): a PORTFOLIO-scoped Workspace is governed by no Business, so
    // createProject now refuses this for every principal — created directly
    // with Prisma instead, since this fixture exists to exercise
    // business-strategy-mutation-service's cross-business isolation rule
    // (untouched by this wave), not project-service's own authorization.
    sharedProject = await prisma.project.create({
      data: { code: `PRJ-F59S-${suffix}`, workspaceId: wsShared.id, name: `FR059 Shared Project ${suffix}` },
    })
    expect(sharedProject.businessId).toBeNull()

    await ensureLocalDemoOwner()

    // A control roadmap+goal the rest of this suite never touches, so the
    // pinned-shape GET assertion at the bottom of this file has fixed,
    // untouched data to read back.
    const controlRoadmap = await createRoadmap(
      { businessId: controlBusiness.id, title: 'Control Direction', horizons: twoHorizons },
      { viewer: OWNER }
    )
    await createGoal(
      { businessId: controlBusiness.id, roadmapId: controlRoadmap.id, horizonId: controlRoadmap.horizons[0].id, title: 'Control Goal' },
      { viewer: OWNER }
    )
  })

  it('refuses a non-OWNER viewer', async () => {
    await expect(
      createRoadmap({ businessId: businessA.id, title: 'Blocked', horizons: twoHorizons }, { viewer: MEMBER })
    ).rejects.toMatchObject({ message: 'Owner permission is required', status: 403 })
  })

  describe('roadmap create/update + horizon cardinality', () => {
    let roadmap

    it('creates a roadmap with 2-3 horizons and records one CREATED AuditEvent', async () => {
      roadmap = await createRoadmap(
        { businessId: businessA.id, title: 'Business A Direction', horizons: twoHorizons },
        { viewer: OWNER }
      )
      expect(roadmap.horizons.map((h) => h.key)).toEqual(['SHORT', 'MEDIUM'])

      const audit = await auditFor('BUSINESS_ROADMAP', roadmap.id, 'CREATED')
      expect(audit).toBeTruthy()
      const payload = JSON.parse(audit.payloadJson)
      expect(payload).toMatchObject({ code: roadmap.code, businessId: businessA.id, horizonKeys: ['SHORT', 'MEDIUM'] })
    })

    it('rejects a 4th horizon on create', async () => {
      const four = [...twoHorizons, { key: 'LONG', label: 'Long', position: 3 }, { key: 'EXTRA', label: 'Extra', position: 4 }]
      await expect(
        createRoadmap({ businessId: businessA.id, title: 'Too many', horizons: four }, { viewer: OWNER })
      ).rejects.toThrow('Business roadmap must have 2 or 3 horizons')
    })

    it('rejects fewer than 2 horizons on create', async () => {
      await expect(
        createRoadmap({ businessId: businessA.id, title: 'Too few', horizons: [twoHorizons[0]] }, { viewer: OWNER })
      ).rejects.toThrow('Business roadmap must have 2 or 3 horizons')
    })

    it('rejects a duplicate horizon key on create (SHOULD-FIX 9 — pre-write validation, not a raw P2002)', async () => {
      await expect(
        createRoadmap(
          { businessId: businessA.id, title: 'Dup key', horizons: [twoHorizons[0], { ...twoHorizons[1], key: twoHorizons[0].key }] },
          { viewer: OWNER }
        )
      ).rejects.toMatchObject({ message: expect.stringMatching(/Duplicate horizon key/), status: 400 })
    })

    it('rejects a duplicate horizon position on create (SHOULD-FIX 9)', async () => {
      await expect(
        createRoadmap(
          {
            businessId: businessA.id,
            title: 'Dup position',
            horizons: [twoHorizons[0], { ...twoHorizons[1], position: twoHorizons[0].position }],
          },
          { viewer: OWNER }
        )
      ).rejects.toMatchObject({ message: expect.stringMatching(/Duplicate horizon position/), status: 400 })
    })

    it('updates the roadmap, replacing horizons, and records one UPDATED AuditEvent', async () => {
      const updated = await updateRoadmap(
        roadmap.id,
        { title: 'Business A Direction v2', horizons: [...twoHorizons, { key: 'LONG', label: 'Long term', position: 3 }] },
        { viewer: OWNER }
      )
      expect(updated.title).toBe('Business A Direction v2')
      expect(updated.horizons.map((h) => h.key)).toEqual(['SHORT', 'MEDIUM', 'LONG'])

      const audit = await auditFor('BUSINESS_ROADMAP', roadmap.id, 'UPDATED')
      expect(audit).toBeTruthy()
      expect(JSON.parse(audit.payloadJson)).toMatchObject({ title: 'Business A Direction v2' })
      roadmap = updated
    })

    it('rejects an update to a 4th horizon and leaves the existing set untouched', async () => {
      const four = [...twoHorizons, { key: 'LONG', label: 'Long', position: 3 }, { key: 'EXTRA', label: 'Extra', position: 4 }]
      await expect(updateRoadmap(roadmap.id, { horizons: four }, { viewer: OWNER })).rejects.toThrow(
        'Business roadmap must have 2 or 3 horizons'
      )
      const horizons = await prisma.businessRoadmapHorizon.findMany({ where: { roadmapId: roadmap.id } })
      expect(horizons).toHaveLength(3)
      expect(horizons.map((h) => h.key).sort()).toEqual(['LONG', 'MEDIUM', 'SHORT'])
    })

    it('an empty PATCH does not bump version or write an UPDATED AuditEvent (SHOULD-FIX 9)', async () => {
      const before = await prisma.businessRoadmap.findUnique({ where: { id: roadmap.id } })
      const auditCountBefore = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_ROADMAP', entityId: roadmap.id, action: 'UPDATED' } })

      const result = await updateRoadmap(roadmap.id, {}, { viewer: OWNER })

      const after = await prisma.businessRoadmap.findUnique({ where: { id: roadmap.id } })
      expect(after.version).toBe(before.version)
      const auditCountAfter = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_ROADMAP', entityId: roadmap.id, action: 'UPDATED' } })
      expect(auditCountAfter).toBe(auditCountBefore)
      expect(result.id).toBe(roadmap.id)
    })
  })

  describe('goal create/update + roadmap/horizon isolation', () => {
    let roadmap
    let otherBusinessRoadmap
    let goal

    beforeAll(async () => {
      roadmap = await createRoadmap({ businessId: businessA.id, title: 'Goal host roadmap', horizons: twoHorizons }, { viewer: OWNER })
      otherBusinessRoadmap = await createRoadmap({ businessId: businessB.id, title: 'Business B roadmap', horizons: twoHorizons }, { viewer: OWNER })
    })

    it('creates a goal under its Business roadmap/horizon and records one CREATED AuditEvent', async () => {
      goal = await createGoal(
        { businessId: businessA.id, roadmapId: roadmap.id, horizonId: roadmap.horizons[0].id, title: 'Foundation', priority: 'HIGH' },
        { viewer: OWNER }
      )
      expect(goal.priority).toBe('HIGH')
      expect(goal.status).toBe('PLANNED')

      const audit = await auditFor('BUSINESS_GOAL', goal.id, 'CREATED')
      expect(audit).toBeTruthy()
      const payload = JSON.parse(audit.payloadJson)
      expect(payload).toMatchObject({ code: goal.code, businessId: businessA.id, roadmapId: roadmap.id, horizonId: roadmap.horizons[0].id })
    })

    it('requires horizonId on create — a goal with none would be invisible on the next GET (SHOULD-FIX 5)', async () => {
      await expect(
        createGoal({ businessId: businessA.id, title: 'No horizon' }, { viewer: OWNER })
      ).rejects.toThrow()
    })

    it('rejects a horizonId/roadmapId pair that disagree about which roadmap they belong to (SHOULD-FIX 9)', async () => {
      await expect(
        createGoal(
          { businessId: businessA.id, roadmapId: otherBusinessRoadmap.id, horizonId: roadmap.horizons[0].id, title: 'Mismatched pair' },
          { viewer: OWNER }
        )
      ).rejects.toMatchObject({ message: 'horizonId does not belong to roadmapId', status: 400 })
    })

    it('rejects a horizonId belonging to another Business', async () => {
      await expect(
        createGoal({ businessId: businessA.id, horizonId: otherBusinessRoadmap.horizons[0].id, title: 'Cross-business' }, { viewer: OWNER })
      ).rejects.toMatchObject({ message: 'Horizon does not belong to Business', status: 400 })
    })

    it('updates the goal and records one UPDATED AuditEvent', async () => {
      const updated = await updateGoal(goal.id, { status: 'ACTIVE', progress: 40 }, { viewer: OWNER })
      expect(updated.status).toBe('ACTIVE')
      expect(updated.progress).toBe(40)

      const audit = await auditFor('BUSINESS_GOAL', goal.id, 'UPDATED')
      expect(audit).toBeTruthy()
      expect(JSON.parse(audit.payloadJson)).toMatchObject({ status: 'ACTIVE', progress: 40 })
    })

    it('rejects moving the goal to a roadmap owned by another Business', async () => {
      await expect(updateGoal(goal.id, { roadmapId: otherBusinessRoadmap.id }, { viewer: OWNER })).rejects.toMatchObject({
        message: 'Roadmap does not belong to Business',
        status: 400,
      })
    })

    it('an empty PATCH does not bump version or write an UPDATED AuditEvent (SHOULD-FIX 9)', async () => {
      const before = await prisma.businessGoal.findUnique({ where: { id: goal.id } })
      const auditCountBefore = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_GOAL', entityId: goal.id, action: 'UPDATED' } })

      const result = await updateGoal(goal.id, {}, { viewer: OWNER })

      const after = await prisma.businessGoal.findUnique({ where: { id: goal.id } })
      expect(after.version).toBe(before.version)
      const auditCountAfter = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_GOAL', entityId: goal.id, action: 'UPDATED' } })
      expect(auditCountAfter).toBe(auditCountBefore)
      expect(result.id).toBe(goal.id)
    })

    describe('Goal <-> Project link/unlink and Business isolation', () => {
      it('links a Project owned by the same Business and records one LINKED AuditEvent', async () => {
        const linked = await linkProjectToGoal(goal.id, { projectId: projectA.id }, { viewer: OWNER })
        expect(linked.projects.map((p) => p.id)).toContain(projectA.id)

        const audit = await auditFor('PROJECT_GOAL', `${goal.id}:${projectA.id}`, 'LINKED')
        expect(audit).toBeTruthy()
        expect(JSON.parse(audit.payloadJson)).toEqual({ goalId: goal.id, projectId: projectA.id })
      })

      it('rejects re-linking an already-linked Project with 409, not a raw P2002/500 (SHOULD-FIX 9)', async () => {
        await expect(linkProjectToGoal(goal.id, { projectId: projectA.id }, { viewer: OWNER })).rejects.toMatchObject({
          message: 'Project is already linked to this Goal',
          status: 409,
        })
      })

      it('rejects linking a Project owned by a different Business (the isolation rule)', async () => {
        await expect(linkProjectToGoal(goal.id, { projectId: projectB.id }, { viewer: OWNER })).rejects.toMatchObject({
          message: 'Project does not belong to Business',
          status: 400,
        })
      })

      it('rejects linking a shared Project with a null Business owner', async () => {
        await expect(linkProjectToGoal(goal.id, { projectId: sharedProject.id }, { viewer: OWNER })).rejects.toMatchObject({
          message: 'Project does not belong to Business',
          status: 400,
        })
      })

      it('unlinks the Project and records one UNLINKED AuditEvent', async () => {
        const unlinked = await unlinkProjectFromGoal(goal.id, projectA.id, { viewer: OWNER })
        expect(unlinked.projects.map((p) => p.id)).not.toContain(projectA.id)

        const audit = await auditFor('PROJECT_GOAL', `${goal.id}:${projectA.id}`, 'UNLINKED')
        expect(audit).toBeTruthy()
        expect(JSON.parse(audit.payloadJson)).toEqual({ goalId: goal.id, projectId: projectA.id })
      })
    })
  })

  describe('Business visibility isolation (BLOCKER 1 — RED/GREEN probe)', () => {
    let businessBRoadmap
    let businessBGoal
    let ownerScopedToA

    beforeAll(async () => {
      // OWNER of Business A only — no relationship to Business B at all, so B
      // never appears in visibleBusinessIds either. Passing ownedBusinessIds
      // equal to visibleBusinessIds infers role 'OWNER' without a literal.
      ownerScopedToA = makeViewer({
        principal: { id: 'fr059-owner-scoped-a' },
        visibleBusinessIds: [businessA.id],
        ownedBusinessIds: [businessA.id],
      })
      businessBRoadmap = await createRoadmap({ businessId: businessB.id, title: 'B-only roadmap', horizons: twoHorizons }, { viewer: OWNER })
      businessBGoal = await createGoal(
        { businessId: businessB.id, roadmapId: businessBRoadmap.id, horizonId: businessBRoadmap.horizons[0].id, title: 'B-only goal' },
        { viewer: OWNER }
      )
      await linkProjectToGoal(businessBGoal.id, { projectId: projectB.id }, { viewer: OWNER })
    })

    it('refuses createRoadmap for a Business outside the viewer scope', async () => {
      await expect(
        createRoadmap({ businessId: businessB.id, title: 'Should be blocked', horizons: twoHorizons }, { viewer: ownerScopedToA })
      ).rejects.toThrow('Business access denied (not owned)')
    })

    it('refuses updateRoadmap for a roadmap owned by a Business outside the viewer scope', async () => {
      await expect(
        updateRoadmap(businessBRoadmap.id, { title: 'Hijacked' }, { viewer: ownerScopedToA })
      ).rejects.toThrow('Business access denied (not owned)')
    })

    it('refuses createGoal for a Business outside the viewer scope', async () => {
      await expect(
        createGoal(
          { businessId: businessB.id, roadmapId: businessBRoadmap.id, horizonId: businessBRoadmap.horizons[0].id, title: 'Should be blocked' },
          { viewer: ownerScopedToA }
        )
      ).rejects.toThrow('Business access denied (not owned)')
    })

    it('refuses updateGoal for a goal owned by a Business outside the viewer scope', async () => {
      await expect(
        updateGoal(businessBGoal.id, { title: 'Hijacked' }, { viewer: ownerScopedToA })
      ).rejects.toThrow('Business access denied (not owned)')
    })

    it('refuses linkProjectToGoal for a goal owned by a Business outside the viewer scope', async () => {
      await expect(
        linkProjectToGoal(businessBGoal.id, { projectId: projectB.id }, { viewer: ownerScopedToA })
      ).rejects.toThrow('Business access denied (not owned)')
    })

    it('refuses unlinkProjectFromGoal for a goal owned by a Business outside the viewer scope', async () => {
      await expect(
        unlinkProjectFromGoal(businessBGoal.id, projectB.id, { viewer: ownerScopedToA })
      ).rejects.toThrow('Business access denied (not owned)')
    })
  })

  // T3b-1 FIX 1: the `ownerScopedToA` fixture above builds a viewer shape
  // resolveViewer can never actually produce — a real principal who is OWNER
  // of Business A and has no relationship at all to Business B never has B in
  // visibleBusinessIds either, so the old assertBusinessVisible(visibleBusinessIds)
  // check already blocked it, and the suite stayed green even while the real
  // hole (role is a *global* OWNER label — see resolve-viewer.js) was open.
  // The realistic adversarial shape is: OWNER of Business A (so `role` is the
  // global 'OWNER' label) and merely MEMBER of Business B (so B is legitimately
  // in visibleBusinessIds via that Membership, but never in ownedBusinessIds).
  describe('Business ownership isolation (T3b-1 FIX 1 — realistic OWNER-of-A/MEMBER-of-B viewer)', () => {
    let ownedRoadmap
    let ownedGoal
    // Business B is visible (a real MEMBER Membership would populate this),
    // but NOT owned — only Business A is. This is the shape resolveViewer
    // actually produces for "OWNER of A, MEMBER of B" (resolve-viewer.js
    // ownedBusinessIds is the per-Business OWNER-membership set, disjoint
    // from a plain MEMBER Membership even though role is still the global
    // 'OWNER' label and visibleBusinessIds legitimately includes B) — this is
    // exactly the shape ownsElsewhere() in tests/factories/viewer.js names.
    let ownerOfAMemberOfB

    beforeAll(async () => {
      ownerOfAMemberOfB = ownsElsewhere({
        owns: businessA.id,
        sees: businessB.id,
        principal: { id: 'fr059-owner-of-a-member-of-b' },
      })
      ownedRoadmap = await createRoadmap({ businessId: businessB.id, title: 'B-owned-elsewhere roadmap', horizons: twoHorizons }, { viewer: OWNER })
      ownedGoal = await createGoal(
        { businessId: businessB.id, roadmapId: ownedRoadmap.id, horizonId: ownedRoadmap.horizons[0].id, title: 'B-owned-elsewhere goal' },
        { viewer: OWNER }
      )
      await linkProjectToGoal(ownedGoal.id, { projectId: projectB.id }, { viewer: OWNER })
    })

    it('refuses createRoadmap for a Business the viewer can see but does not own', async () => {
      await expect(
        createRoadmap({ businessId: businessB.id, title: 'Should be blocked', horizons: twoHorizons }, { viewer: ownerOfAMemberOfB })
      ).rejects.toMatchObject({ status: 400 })
    })

    it('refuses updateRoadmap for a roadmap owned by a Business the viewer can see but does not own', async () => {
      await expect(
        updateRoadmap(ownedRoadmap.id, { title: 'Hijacked' }, { viewer: ownerOfAMemberOfB })
      ).rejects.toMatchObject({ status: 400 })
    })

    it('refuses createGoal for a Business the viewer can see but does not own', async () => {
      await expect(
        createGoal(
          { businessId: businessB.id, roadmapId: ownedRoadmap.id, horizonId: ownedRoadmap.horizons[0].id, title: 'Should be blocked' },
          { viewer: ownerOfAMemberOfB }
        )
      ).rejects.toMatchObject({ status: 400 })
    })

    it('refuses updateGoal for a goal owned by a Business the viewer can see but does not own', async () => {
      await expect(
        updateGoal(ownedGoal.id, { title: 'Hijacked' }, { viewer: ownerOfAMemberOfB })
      ).rejects.toMatchObject({ status: 400 })
    })

    it('refuses linkProjectToGoal for a goal owned by a Business the viewer can see but does not own', async () => {
      await expect(
        linkProjectToGoal(ownedGoal.id, { projectId: projectB.id }, { viewer: ownerOfAMemberOfB })
      ).rejects.toMatchObject({ status: 400 })
    })

    it('refuses unlinkProjectFromGoal for a goal owned by a Business the viewer can see but does not own', async () => {
      await expect(
        unlinkProjectFromGoal(ownedGoal.id, projectB.id, { viewer: ownerOfAMemberOfB })
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('Horizon replace preserves goals (BLOCKER 2 — RED/GREEN probe)', () => {
    it('keeps a goal attached to its horizon after a roadmap horizons PATCH renames that horizon', async () => {
      const roadmap = await createRoadmap({ businessId: businessA.id, title: 'B2 roadmap', horizons: twoHorizons }, { viewer: OWNER })
      const goal = await createGoal(
        { businessId: businessA.id, roadmapId: roadmap.id, horizonId: roadmap.horizons[0].id, title: 'B2 goal' },
        { viewer: OWNER }
      )
      await updateRoadmap(
        roadmap.id,
        {
          horizons: [
            { key: 'SHORT', label: 'Short term (renamed)', position: 1 },
            { key: 'MEDIUM', label: 'Medium term', position: 2 },
          ],
        },
        { viewer: OWNER }
      )
      const strategy = await fetchStrategy(businessA.id)
      const readRoadmap = strategy.roadmaps.find((r) => r.id === roadmap.id)
      const allGoalIds = readRoadmap.horizons.flatMap((h) => h.goals.map((g) => g.id))
      expect(allGoalIds).toContain(goal.id)
    })

    it('refuses to remove a horizon that still has goals attached, rather than orphaning them', async () => {
      const roadmap = await createRoadmap({ businessId: businessA.id, title: 'B2 refuse-removal roadmap', horizons: twoHorizons }, { viewer: OWNER })
      await createGoal(
        { businessId: businessA.id, roadmapId: roadmap.id, horizonId: roadmap.horizons[0].id, title: 'Attached goal' },
        { viewer: OWNER }
      )
      await expect(
        updateRoadmap(
          roadmap.id,
          { horizons: [{ key: 'MEDIUM', label: 'Medium term', position: 1 }, { key: 'LONG', label: 'Long term', position: 2 }] },
          { viewer: OWNER }
        )
      ).rejects.toMatchObject({ message: expect.stringMatching(/Cannot remove horizon "SHORT"/), status: 400 })

      const horizons = await prisma.businessRoadmapHorizon.findMany({ where: { roadmapId: roadmap.id } })
      expect(horizons.map((h) => h.key).sort()).toEqual(['MEDIUM', 'SHORT'])
    })
  })

  describe('Mutation DTO / FR-041 read model parity (SHOULD-FIX 8)', () => {
    it('the Goal DTO returned by the mutation service matches the corresponding node in GET /api/business/strategy exactly', async () => {
      const parityRoadmap = await createRoadmap({ businessId: businessA.id, title: 'Parity Roadmap', horizons: twoHorizons }, { viewer: OWNER })
      const parityGoal = await createGoal(
        { businessId: businessA.id, roadmapId: parityRoadmap.id, horizonId: parityRoadmap.horizons[0].id, title: 'Parity Goal' },
        { viewer: OWNER }
      )
      const linked = await linkProjectToGoal(parityGoal.id, { projectId: projectA.id }, { viewer: OWNER })

      const strategy = await fetchStrategy(businessA.id)
      const readGoal = strategy.roadmaps
        .find((r) => r.id === parityRoadmap.id)
        ?.horizons.find((h) => h.id === parityRoadmap.horizons[0].id)
        ?.goals.find((g) => g.id === parityGoal.id)

      expect(readGoal).toBeTruthy()
      // Normalize Date instances to the same ISO strings the JSON GET
      // response already carries, so this compares values, not JS types.
      expect(JSON.parse(JSON.stringify(linked))).toEqual(readGoal)
    })

    it('the Roadmap DTO (and its horizon objects) returned by the mutation service matches the corresponding node in GET /api/business/strategy exactly', async () => {
      const parityRoadmap = await createRoadmap(
        { businessId: businessA.id, title: 'Roadmap Parity Roadmap', horizons: twoHorizons },
        { viewer: OWNER }
      )

      const strategy = await fetchStrategy(businessA.id)
      const readRoadmap = strategy.roadmaps.find((r) => r.id === parityRoadmap.id)

      expect(readRoadmap).toBeTruthy()
      // Same normalization as the Goal comparison above: Dates -> ISO strings
      // so this compares values, not JS types. Covers the roadmap-level
      // id/code/title/description/status/startAt/targetAt fields and the
      // horizon object shape (id/key/label/position/description/targetAt),
      // not just the Goal DTO the earlier test already checks.
      expect(JSON.parse(JSON.stringify(parityRoadmap))).toEqual(readRoadmap)
    })
  })

  describe('Route-level HTTP status mapping (SHOULD-FIX 6)', () => {
    let routeRoadmap
    let routeGoal
    let crossBusinessRoadmap

    beforeAll(async () => {
      crossBusinessRoadmap = await createRoadmap(
        { businessId: businessB.id, title: 'Route cross-business roadmap', horizons: twoHorizons },
        { viewer: OWNER }
      )
    })

    it('POST /api/business/roadmaps returns 200 with the serialized Roadmap', async () => {
      const res = await postRoadmapRoute(
        demoRequest('http://local/api/business/roadmaps', {
          method: 'POST',
          body: { businessId: businessA.id, title: 'Route Roadmap', horizons: twoHorizons },
        })
      )
      expect(res.status).toBe(200)
      routeRoadmap = await res.json()
      expect(routeRoadmap.title).toBe('Route Roadmap')
    })

    it('POST /api/business/roadmaps returns 400 for an invalid horizon count (handle() status mapping)', async () => {
      const res = await postRoadmapRoute(
        demoRequest('http://local/api/business/roadmaps', {
          method: 'POST',
          body: { businessId: businessA.id, title: 'Bad Roadmap', horizons: [twoHorizons[0]] },
        })
      )
      expect(res.status).toBe(400)
    })

    it('POST /api/business/roadmaps returns 400 for a negative horizon position (bounded at the schema, not a P2002)', async () => {
      const res = await postRoadmapRoute(
        demoRequest('http://local/api/business/roadmaps', {
          method: 'POST',
          body: {
            businessId: businessA.id,
            title: 'Negative Position Roadmap',
            horizons: [{ key: 'SHORT', label: 'Short', position: -1 }, { key: 'MEDIUM', label: 'Medium', position: 2 }],
          },
        })
      )
      expect(res.status).toBe(400)
    })

    it('POST /api/business/roadmaps returns 400 for a businessId outside viewer ownership (assertBusinessOwned sets status explicitly)', async () => {
      const res = await postRoadmapRoute(
        demoRequest('http://local/api/business/roadmaps', {
          method: 'POST',
          body: { businessId: 'nonexistent-business-id', title: 'Should be blocked', horizons: twoHorizons },
        })
      )
      expect(res.status).toBe(400)
    })

    it('PATCH /api/business/roadmaps/[id] returns 200 with the updated Roadmap', async () => {
      const res = await patchRoadmapRoute(
        demoRequest(`http://local/api/business/roadmaps/${routeRoadmap.id}`, { method: 'PATCH', body: { title: 'Route Roadmap v2' } }),
        { params: { id: routeRoadmap.id } }
      )
      expect(res.status).toBe(200)
      const updated = await res.json()
      expect(updated.title).toBe('Route Roadmap v2')
    })

    it('POST /api/business/goals returns 200 with the serialized Goal', async () => {
      const res = await postGoalRoute(
        demoRequest('http://local/api/business/goals', {
          method: 'POST',
          body: { businessId: businessA.id, roadmapId: routeRoadmap.id, horizonId: routeRoadmap.horizons[0].id, title: 'Route Goal' },
        })
      )
      expect(res.status).toBe(200)
      routeGoal = await res.json()
      expect(routeGoal.title).toBe('Route Goal')
    })

    it('POST /api/business/goals returns 400 for a cross-Business horizonId (isolation, SHOULD-FIX 4)', async () => {
      const res = await postGoalRoute(
        demoRequest('http://local/api/business/goals', {
          method: 'POST',
          body: { businessId: businessA.id, horizonId: crossBusinessRoadmap.horizons[0].id, title: 'Should fail' },
        })
      )
      expect(res.status).toBe(400)
    })

    it('PATCH /api/business/goals/[id] returns 200 with the updated Goal', async () => {
      const res = await patchGoalRoute(
        demoRequest(`http://local/api/business/goals/${routeGoal.id}`, { method: 'PATCH', body: { status: 'ACTIVE' } }),
        { params: { id: routeGoal.id } }
      )
      expect(res.status).toBe(200)
      const updated = await res.json()
      expect(updated.status).toBe('ACTIVE')
    })

    it('POST /api/business/goals/[id]/projects returns 200 and links the Project', async () => {
      const res = await postGoalProjectRoute(
        demoRequest(`http://local/api/business/goals/${routeGoal.id}/projects`, { method: 'POST', body: { projectId: projectA.id } }),
        { params: { id: routeGoal.id } }
      )
      expect(res.status).toBe(200)
      const linked = await res.json()
      expect(linked.projects.map((p) => p.id)).toContain(projectA.id)
    })

    it('DELETE /api/business/goals/[id]/projects/[projectId] returns 200 and unlinks the Project', async () => {
      const res = await deleteGoalProjectRoute(
        demoRequest(`http://local/api/business/goals/${routeGoal.id}/projects/${projectA.id}`, { method: 'DELETE' }),
        { params: { id: routeGoal.id, projectId: projectA.id } }
      )
      expect(res.status).toBe(200)
      const unlinked = await res.json()
      expect(unlinked.projects.map((p) => p.id)).not.toContain(projectA.id)
    })
  })

  it('GET /api/business/strategy exposes the untouched control Roadmap/Goal in the expected shape (SHOULD-FIX 7 — pinned, not a same-run snapshot)', async () => {
    const strategy = await fetchStrategy(controlBusiness.id)
    expect(strategy.business.id).toBe(controlBusiness.id)
    expect(strategy.roadmaps).toHaveLength(1)

    const [roadmap] = strategy.roadmaps
    expect(roadmap.title).toBe('Control Direction')
    expect(roadmap.status).toBe('ACTIVE')
    expect(roadmap.horizons.map((h) => h.key)).toEqual(['SHORT', 'MEDIUM'])
    expect(roadmap.horizons[0].goals.map((g) => g.title)).toEqual(['Control Goal'])
    expect(roadmap.horizons[1].goals).toEqual([])

    expect(strategy.activeRoadmapId).toBe(roadmap.id)
    expect(strategy.summary).toMatchObject({ roadmapCount: 1, horizonCount: 2, goalCount: 1, averageProgress: 0 })
  })
})
