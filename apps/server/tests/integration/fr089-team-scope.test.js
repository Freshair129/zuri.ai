import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { createProject } from '@/modules/project-manager/application/project-service'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import {
  addTeamMember,
  archiveTeam,
  attachTeamToProject,
  createTeam,
  detachTeamFromProject,
  getTeam,
  listProjectTeams,
  listTeams,
  removeTeamMember,
  updateTeam,
} from '@/modules/project-manager/application/team-service'

// @req FR-089 — a Team is Business-scoped, and every read and write is bound to
// a Business the viewer may act on.
// @spec BR-018, SEC-001, SEC-008, BR-001,
//   docs/decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md
// @tested tests/integration/fr089-team-scope.test.js
//
// Every refusal below is paired with its control: the same call, the same
// target, a viewer who does own it, and it succeeds. A guard that refuses
// everything is not a guard, and a suite that only tests refusals cannot tell
// the two apart.
//
// The attacker shape is `ownsElsewhere`: OWNER of Business B, merely able to see
// Business A. The global `role` label genuinely reads 'OWNER' and A genuinely
// appears in `visibleBusinessIds`, which is exactly the combination that
// defeated three guards before
// (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md).

let tenantId, businessA, businessB, projectA, projectB
let ownerA, ownerB, attacker, ownsBoth
let personA, personB

const tag = () => randomUUID().slice(0, 8)

async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

async function seedPerson(prefix, businessId) {
  const t = tag()
  const person = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-${prefix}-${t}`, displayName: `${prefix} ${t}` },
  })
  await prisma.membership.create({
    data: { id: randomUUID(), tenantId, businessId, personId: person.id, role: 'MEMBER', domainKeysJson: '[]' },
  })
  return person
}

async function teamIn(business, owner, name) {
  return createTeam({ businessId: business.id, name }, { viewer: owner })
}

describe('FR-089 Team is Business-scoped', () => {
  beforeAll(async () => {
    const t = tag()
    const portfolio = await createPortfolio({ name: 'Team Group', code: `PF-TEAM-${t}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Team Tenant', code: `TNT-TEAM-${t}` })
    tenantId = tenant.id
    businessA = await createBusiness({ tenantId, name: 'Team Business A', code: `BUS-TEAM-A-${t}` })
    businessB = await createBusiness({ tenantId, name: 'Team Business B', code: `BUS-TEAM-B-${t}` })

    ownerA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id] })
    ownerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id] })
    attacker = ownsElsewhere({ owns: businessB.id, sees: businessA.id })
    ownsBoth = makeViewer({
      visibleBusinessIds: [businessA.id, businessB.id],
      ownedBusinessIds: [businessA.id, businessB.id],
    })

    const wsA = await createWorkspace({ name: 'Team WS A', scopeType: 'BUSINESS', businessId: businessA.id, code: `WS-TEAM-A-${t}` })
    const wsB = await createWorkspace({ name: 'Team WS B', scopeType: 'BUSINESS', businessId: businessB.id, code: `WS-TEAM-B-${t}` })
    projectA = await createProject({ workspaceId: wsA.id, name: 'Team Project A', code: `PRJ-TEAM-A-${t}` }, { viewer: ownerA })
    projectB = await createProject({ workspaceId: wsB.id, name: 'Team Project B', code: `PRJ-TEAM-B-${t}` }, { viewer: ownerB })

    personA = await seedPerson('A', businessA.id)
    personB = await seedPerson('B', businessB.id)
  })

  describe('creating a Team', () => {
    it('refuses an OWNER of a different Business in the same tenant', async () => {
      expect(attacker.role).toBe('OWNER') // the global label really is OWNER
      expect(attacker.visibleBusinessIds).toContain(businessA.id) // and A really is visible
      expect(attacker.ownedBusinessIds).not.toContain(businessA.id) // …and still owns nothing here

      const error = await refusalFrom(() => createTeam({ businessId: businessA.id, name: 'Squad' }, { viewer: attacker }))
      expect(error.status).toBe(404)
      expect(await prisma.team.findFirst({ where: { businessId: businessA.id, name: 'Squad' } })).toBeNull()
    })

    it('refuses with no viewer at all, loudly', async () => {
      const error = await refusalFrom(() => createTeam({ businessId: businessA.id, name: 'Squad' }, {}))
      expect(error.message).toMatch(/viewer is required/i)
    })

    it('lets the owner create one, with a generated human code', async () => {
      const team = await teamIn(businessA, ownerA, 'Platform Squad')
      expect(team.businessId).toBe(businessA.id)
      expect(team.code).toMatch(/^TEAM-PLATFORM-SQUAD/)
      // BR-002 — the primary key is an internal uuid, never the human code.
      expect(team.id).not.toBe(team.code)
      const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'TEAM', entityId: team.id, action: 'CREATED' } })
      expect(audit).not.toBeNull()
    })
  })

  describe('reading a Team', () => {
    it('refuses a Business the viewer cannot see, rather than returning an empty list', async () => {
      await teamIn(businessB, ownerB, 'B Only')
      const error = await refusalFrom(() => listTeams({ businessId: businessB.id }, { viewer: ownerA }))
      expect(error.status).toBe(404)
    })

    it('refuses an out-of-scope Team by id, with the message a missing one gives', async () => {
      const team = await teamIn(businessB, ownerB, 'Hidden Squad')
      const error = await refusalFrom(() => getTeam(team.id, { viewer: ownerA }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Team not found')
      // Indistinguishable from an id that does not exist: no enumeration oracle.
      const absent = await refusalFrom(() => getTeam(randomUUID(), { viewer: ownerA }))
      expect(absent.message).toBe(error.message)
    })

    it('shows a visible-but-unowned Business its Teams, and says they are not manageable', async () => {
      // The FR-062 shape: the read is allowed to be wider than the write, but it
      // must report the write's authority field rather than let the surface guess.
      const teams = await listTeams({ businessId: businessA.id }, { viewer: attacker })
      expect(teams.length).toBeGreaterThan(0)
      expect(teams.every((t) => t.manageable === false)).toBe(true)

      const owned = await listTeams({ businessId: businessA.id }, { viewer: ownerA })
      expect(owned.every((t) => t.manageable === true)).toBe(true)
    })

    it('requires a Business, so no call is ever unscoped', async () => {
      await expect(listTeams({}, { viewer: ownerA })).rejects.toThrow()
    })
  })

  describe('changing and retiring a Team', () => {
    it('refuses an update and an archive from the attacker, and writes nothing', async () => {
      const team = await teamIn(businessA, ownerA, 'Rename Me')
      expect((await refusalFrom(() => updateTeam(team.id, { name: 'Owned' }, { viewer: attacker }))).status).toBe(404)
      expect((await refusalFrom(() => archiveTeam(team.id, { viewer: attacker }))).status).toBe(404)
      const after = await prisma.team.findUnique({ where: { id: team.id } })
      expect(after.name).toBe('Rename Me')
      expect(after.deletedAt).toBeNull()
    })

    it('refuses a patch that tries to move the Team to another Business', async () => {
      const team = await teamIn(businessA, ownerA, 'Stay Put')
      await expect(updateTeam(team.id, { businessId: businessB.id }, { viewer: ownsBoth })).rejects.toThrow()
      expect((await prisma.team.findUnique({ where: { id: team.id } })).businessId).toBe(businessA.id)
    })

    it('lets the owner rename and archive, and an archived Team stops being readable', async () => {
      const team = await teamIn(businessA, ownerA, 'Temporary')
      const renamed = await updateTeam(team.id, { name: 'Renamed' }, { viewer: ownerA })
      expect(renamed.name).toBe('Renamed')

      await archiveTeam(team.id, { viewer: ownerA })
      expect((await refusalFrom(() => getTeam(team.id, { viewer: ownerA }))).status).toBe(404)
      const listed = await listTeams({ businessId: businessA.id }, { viewer: ownerA })
      expect(listed.map((t) => t.id)).not.toContain(team.id)
    })
  })

  describe('BR-018 — moving a Person in and out grants nothing', () => {
    it('refuses the attacker, and writes no TeamMembership', async () => {
      const team = await teamIn(businessA, ownerA, 'Guarded')
      expect((await refusalFrom(() => addTeamMember(team.id, { personId: personA.id }, { viewer: attacker }))).status).toBe(404)
      expect(await prisma.teamMembership.findFirst({ where: { teamId: team.id } })).toBeNull()
    })

    it('refuses a Person with no Membership in the Team\'s Business, and mints none', async () => {
      const team = await teamIn(businessA, ownerA, 'Scoped Roster')
      const before = await prisma.membership.count()
      const error = await refusalFrom(() => addTeamMember(team.id, { personId: personB.id }, { viewer: ownerA }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Person not found')
      // The whole point of BR-018: no convenience branch created the Membership
      // that would have made this call succeed.
      expect(await prisma.membership.count()).toBe(before)
      expect(await prisma.teamMembership.findFirst({ where: { teamId: team.id } })).toBeNull()
    })

    it('adds and removes a Person, and the viewer that Person resolves to is byte-identical', async () => {
      const team = await teamIn(businessA, ownerA, 'Authority Free')
      const before = await resolveViewer({ principalId: personA.id, db: prisma })
      const membershipsBefore = await prisma.membership.count()

      const row = await addTeamMember(team.id, { personId: personA.id }, { viewer: ownerA })
      expect(row.personId).toBe(personA.id)
      // No `role` was accepted and none was stored — ADR-037 D3.
      expect(row.role).toBeUndefined()

      const after = await resolveViewer({ principalId: personA.id, db: prisma })
      expect(after).toEqual(before)
      expect(await prisma.membership.count()).toBe(membershipsBefore)

      // …and the same after removal, so nothing was revoked either.
      await removeTeamMember(team.id, { personId: personA.id }, { viewer: ownerA })
      expect(await resolveViewer({ principalId: personA.id, db: prisma })).toEqual(before)
      expect(await prisma.membership.count()).toBe(membershipsBefore)
    })

    it('refuses a duplicate rather than silently succeeding', async () => {
      const team = await teamIn(businessA, ownerA, 'Once Only')
      await addTeamMember(team.id, { personId: personA.id }, { viewer: ownerA })
      expect((await refusalFrom(() => addTeamMember(team.id, { personId: personA.id }, { viewer: ownerA }))).status).toBe(409)
      expect(await prisma.teamMembership.count({ where: { teamId: team.id } })).toBe(1)
    })

    it('refuses a removal the attacker asks for', async () => {
      const team = await teamIn(businessA, ownerA, 'Sticky')
      await addTeamMember(team.id, { personId: personA.id }, { viewer: ownerA })
      expect((await refusalFrom(() => removeTeamMember(team.id, { personId: personA.id }, { viewer: attacker }))).status).toBe(404)
      expect(await prisma.teamMembership.count({ where: { teamId: team.id } })).toBe(1)
    })

    it('does not leak an email address the roster never renders', async () => {
      const team = await teamIn(businessA, ownerA, 'No Contact Details')
      await prisma.person.update({ where: { id: personA.id }, data: { email: 'roster@secret.example' } })
      await addTeamMember(team.id, { personId: personA.id }, { viewer: ownerA })
      const detail = await getTeam(team.id, { viewer: ownerA })
      expect(detail.members).toHaveLength(1)
      expect(detail.members[0].person.email).toBeUndefined()
    })
  })

  describe('attaching a Team to a Project', () => {
    it('refuses a Project the viewer does not own', async () => {
      const team = await teamIn(businessB, ownerB, 'B Squad')
      await refusalFrom(() => attachTeamToProject(projectA.id, { teamId: team.id }, { viewer: attacker }))
      expect(await prisma.projectTeam.findFirst({ where: { projectId: projectA.id, teamId: team.id } })).toBeNull()
    })

    it('refuses a Team the viewer does not own, even on a Project they do', async () => {
      const teamB = await teamIn(businessB, ownerB, 'Borrowed Squad')
      const error = await refusalFrom(() => attachTeamToProject(projectA.id, { teamId: teamB.id }, { viewer: ownerA }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Team not found')
    })

    it('refuses a cross-Business attach even when the viewer owns both', async () => {
      // Owning both is the case a per-target check would wave through. A Team is
      // Business-scoped (ADR-037 D2), so the two scopes must be the *same* one.
      const teamB = await teamIn(businessB, ownerB, 'Cross Squad')
      const error = await refusalFrom(() => attachTeamToProject(projectA.id, { teamId: teamB.id }, { viewer: ownsBoth }))
      expect(error.status).toBe(400)
      expect(error.message).toMatch(/another Business/i)
      expect(await prisma.projectTeam.findFirst({ where: { projectId: projectA.id, teamId: teamB.id } })).toBeNull()
    })

    it('attaches several Teams to one Project and one Team to several Projects', async () => {
      // ADR-037 D3 — many-to-many, so neither direction forces a fake primary.
      const first = await teamIn(businessB, ownerB, 'First Squad')
      const second = await teamIn(businessB, ownerB, 'Second Squad')
      await attachTeamToProject(projectB.id, { teamId: first.id }, { viewer: ownerB })
      await attachTeamToProject(projectB.id, { teamId: second.id }, { viewer: ownerB })

      const otherProject = await createProject(
        { workspaceId: projectB.workspaceId, name: 'Team Project B2', code: `PRJ-TEAM-B2-${tag()}` },
        { viewer: ownerB },
      )
      await attachTeamToProject(otherProject.id, { teamId: first.id }, { viewer: ownerB })

      const attached = await listProjectTeams(projectB.id, { viewer: ownerB })
      expect(attached.teams.map((t) => t.id).sort()).toEqual([first.id, second.id].sort())
      expect(attached.manageable).toBe(true)

      const alsoAttached = await listProjectTeams(otherProject.id, { viewer: ownerB })
      expect(alsoAttached.teams.map((t) => t.id)).toEqual([first.id])
    })

    it('refuses a duplicate attach, and detaches only for an owner', async () => {
      const team = await teamIn(businessA, ownerA, 'Detachable')
      await attachTeamToProject(projectA.id, { teamId: team.id }, { viewer: ownerA })
      expect((await refusalFrom(() => attachTeamToProject(projectA.id, { teamId: team.id }, { viewer: ownerA }))).status).toBe(409)

      await refusalFrom(() => detachTeamFromProject(projectA.id, { teamId: team.id }, { viewer: attacker }))
      expect(await prisma.projectTeam.findFirst({ where: { projectId: projectA.id, teamId: team.id } })).not.toBeNull()

      await detachTeamFromProject(projectA.id, { teamId: team.id }, { viewer: ownerA })
      expect(await prisma.projectTeam.findFirst({ where: { projectId: projectA.id, teamId: team.id } })).toBeNull()
    })

    it('hides an archived Team from a Project it was attached to', async () => {
      const team = await teamIn(businessA, ownerA, 'Disbanded')
      await attachTeamToProject(projectA.id, { teamId: team.id }, { viewer: ownerA })
      await archiveTeam(team.id, { viewer: ownerA })
      const attached = await listProjectTeams(projectA.id, { viewer: ownerA })
      expect(attached.teams.map((t) => t.id)).not.toContain(team.id)
    })

    it('refuses to list the Teams of a Project in a Business the viewer cannot see', async () => {
      const error = await refusalFrom(() => listProjectTeams(projectB.id, { viewer: ownerA }))
      expect(error.status).toBe(404)
      expect(error.message).toBe('Project not found')
    })
  })

  describe('no viewer at all', () => {
    it('is a loud wiring failure on every entry point, never a quiet write', async () => {
      const team = await teamIn(businessA, ownerA, 'Unwired')
      const calls = [
        () => listTeams({ businessId: businessA.id }, {}),
        () => getTeam(team.id, {}),
        () => updateTeam(team.id, { name: 'x' }, {}),
        () => archiveTeam(team.id, {}),
        () => addTeamMember(team.id, { personId: personA.id }, {}),
        () => removeTeamMember(team.id, { personId: personA.id }, {}),
        () => listProjectTeams(projectA.id, {}),
        () => attachTeamToProject(projectA.id, { teamId: team.id }, {}),
        () => detachTeamFromProject(projectA.id, { teamId: team.id }, {}),
      ]
      for (const call of calls) {
        const error = await refusalFrom(call)
        expect(error.message).toMatch(/viewer is required/i)
      }
    })
  })
})
