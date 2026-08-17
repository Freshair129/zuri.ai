import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import {
  addProjectTeamMember,
  changeProjectTeamRole,
  removeProjectTeamMember,
  listProjectTeam,
} from '@/modules/project-manager/application/project-team-service'

// @req FR-036 — project Team mutations are authorized per Business.
// @spec SEC-001, SEC-008, BR-001,
//   .brain/reviews/pm-triage-2026-08-17.md §S1
// @tested tests/unit/fr036-team-authorization.test.js
//
// The hole this pins: `POST /api/projects/{id}/team` resolved no viewer and the
// service took `role` straight from the request body, so anyone reaching the
// endpoint could mint an **OWNER** Membership for any person in any Business
// that owned a project — and `resolveViewer` builds `ownedBusinessIds` from
// exactly those rows. It was a one-request path to business-owner authority,
// strictly worse than the FR-038 self-promotion hole closed the same morning,
// which at least required already being a global OWNER.
//
// Real database and the real resolver: a mocked viewer cannot show that the
// grant it produces is the grant the resolver would emit.

const tag = () => randomUUID().slice(0, 8)

async function world() {
  const t = tag()
  const tenantId = randomUUID()
  await prisma.tenant.create({
    data: {
      id: tenantId, code: `TEN-${t}`, name: 'Tenant',
      portfolio: { create: { id: randomUUID(), code: `PF-${t}`, name: 'PF' } },
    },
  })
  const target = await prisma.business.create({
    data: { id: randomUUID(), tenantId, code: `BUS-TGT-${t}`, name: 'Target' },
  })
  const other = await prisma.business.create({
    data: { id: randomUUID(), tenantId, code: `BUS-OTH-${t}`, name: 'Other' },
  })
  const workspace = await prisma.workspace.create({
    data: { id: randomUUID(), code: `WS-${t}`, name: 'WS', scopeType: 'BUSINESS', businessId: target.id, tenantId },
  })
  const project = await prisma.project.create({
    data: { id: randomUUID(), code: `PRJ-${t}`, name: 'Project', workspaceId: workspace.id, businessId: target.id },
  })
  const outsider = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-OUT-${t}`, displayName: 'Outsider', email: `out-${t}@secret.example` },
  })
  const victim = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-VIC-${t}`, displayName: 'Victim', email: `vic-${t}@secret.example` },
  })
  // The attacker owns a DIFFERENT Business in the same tenant: the shape that
  // defeats "global OWNER label plus the Business is visible".
  await prisma.membership.create({
    data: { id: randomUUID(), tenantId, businessId: other.id, personId: outsider.id, role: 'OWNER', domainKeysJson: '[]' },
  })
  const attacker = await resolveViewer({ principalId: outsider.id, db: prisma })
  return { tenantId, target, other, project, victim, outsider, attacker }
}

describe('the escalation this closes', () => {
  it('refuses to mint a Membership with no viewer at all', async () => {
    const w = await world()
    await expect(
      addProjectTeamMember(w.project.id, { personId: w.victim.id, role: 'OWNER' }, { db: prisma }),
    ).rejects.toThrow()
  })

  it('refuses an OWNER of a different Business in the same tenant', async () => {
    const w = await world()
    expect(w.attacker.role).toBe('OWNER') // the global label is genuinely OWNER
    expect(w.attacker.ownedBusinessIds).not.toContain(w.target.id)

    await expect(
      addProjectTeamMember(w.project.id, { personId: w.victim.id, role: 'OWNER' }, { db: prisma, viewer: w.attacker }),
    ).rejects.toThrow()
  })

  it('writes nothing when it refuses', async () => {
    const w = await world()
    await addProjectTeamMember(w.project.id, { personId: w.victim.id, role: 'OWNER' }, { db: prisma, viewer: w.attacker })
      .catch(() => {})
    const created = await prisma.membership.findFirst({ where: { personId: w.victim.id, businessId: w.target.id } })
    expect(created).toBeNull()
  })

  it('refuses a role change and a removal from the same attacker', async () => {
    const w = await world()
    const seat = await prisma.membership.create({
      data: { id: randomUUID(), tenantId: w.tenantId, businessId: w.target.id, personId: w.victim.id, role: 'MEMBER', domainKeysJson: '[]' },
    })
    await expect(
      changeProjectTeamRole(w.project.id, { membershipId: seat.id, role: 'OWNER' }, { db: prisma, viewer: w.attacker }),
    ).rejects.toThrow()
    await expect(
      removeProjectTeamMember(w.project.id, { membershipId: seat.id }, { db: prisma, viewer: w.attacker }),
    ).rejects.toThrow()
    const still = await prisma.membership.findUnique({ where: { id: seat.id } })
    expect(still.role).toBe('MEMBER')
  })
})

describe('the legitimate owner is unaffected', () => {
  it('adds, promotes and removes within a Business it owns', async () => {
    const w = await world()
    const boss = await prisma.person.create({
      data: { id: randomUUID(), code: `PER-BOSS-${tag()}`, displayName: 'Boss' },
    })
    await prisma.membership.create({
      data: { id: randomUUID(), tenantId: w.tenantId, businessId: w.target.id, personId: boss.id, role: 'OWNER', domainKeysJson: '[]' },
    })
    const owner = await resolveViewer({ principalId: boss.id, db: prisma })
    expect(owner.ownedBusinessIds).toContain(w.target.id)

    const added = await addProjectTeamMember(w.project.id, { personId: w.victim.id, role: 'MEMBER' }, { db: prisma, viewer: owner })
    expect(added.role).toBe('MEMBER')
    const promoted = await changeProjectTeamRole(w.project.id, { membershipId: added.id, role: 'OWNER' }, { db: prisma, viewer: owner })
    expect(promoted.role).toBe('OWNER')
    await removeProjectTeamMember(w.project.id, { membershipId: added.id }, { db: prisma, viewer: owner })
    expect(await prisma.membership.findUnique({ where: { id: added.id } })).toBeNull()
  })
})

describe('the team list stops handing out every Person in the database', () => {
  it('offers only people inside the project tenant', async () => {
    const w = await world()
    // A person in a completely unrelated tenant.
    const farTenantId = randomUUID()
    const t = tag()
    await prisma.tenant.create({
      data: {
        id: farTenantId, code: `TEN-FAR-${t}`, name: 'Far',
        portfolio: { create: { id: randomUUID(), code: `PF-FAR-${t}`, name: 'PF' } },
      },
    })
    const farBusiness = await prisma.business.create({
      data: { id: randomUUID(), tenantId: farTenantId, code: `BUS-FAR-${t}`, name: 'Far' },
    })
    const stranger = await prisma.person.create({
      data: { id: randomUUID(), code: `PER-FAR-${t}`, displayName: 'Stranger', email: `far-${t}@secret.example` },
    })
    await prisma.membership.create({
      data: { id: randomUUID(), tenantId: farTenantId, businessId: farBusiness.id, personId: stranger.id, role: 'MEMBER', domainKeysJson: '[]' },
    })

    const boss = await prisma.person.create({ data: { id: randomUUID(), code: `PER-B2-${tag()}`, displayName: 'Boss2' } })
    await prisma.membership.create({
      data: { id: randomUUID(), tenantId: w.tenantId, businessId: w.target.id, personId: boss.id, role: 'OWNER', domainKeysJson: '[]' },
    })
    const owner = await resolveViewer({ principalId: boss.id, db: prisma })

    const team = await listProjectTeam(w.project.id, { db: prisma, viewer: owner })
    const offered = team.availablePeople.map((p) => p.id)
    expect(offered).not.toContain(stranger.id)
  })
})
