// @req FR-036 — project-context membership list, business-scoped mutations, and assignee load.
// @spec SDD-015, BR-001, SEC-003, docs/features/FR-036-project-team.md
// @tested tests/unit/project-team-service.test.js
import prisma from '@/lib/db'
import { z } from 'zod'
import { zMembershipRole } from '@/lib/validation/enums'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from './audit'

// @req FR-036 — team mutations are authorized per Business.
// @spec SEC-001, SEC-008, .brain/reviews/pm-triage-2026-08-17.md §S1
// @tested tests/unit/fr036-team-authorization.test.js
//
// These four functions write Membership rows, including the OWNER role that
// `resolveViewer` turns into `ownedBusinessIds`. Until 2026-08-17 the route in
// front of them resolved no viewer and took `role` from the request body, so a
// single unauthenticated POST minted business-owner authority. Both guards fail
// closed on a missing viewer: a caller that forgets to pass one is refused, not
// admitted.
function assertTeamWritable(businessId, viewer) {
  if (ownsBusiness(viewer, businessId)) return
  const error = new Error('Project team is outside your owned scope')
  error.status = 404
  throw error
}

function assertTeamReadable(businessId, viewer) {
  // Reading a team is weaker than changing it, but it still exposes people and
  // their roles, so it is not open either.
  if (seesBusiness(viewer, businessId) || ownsBusiness(viewer, businessId)) return
  const error = new Error('Project team is outside your visible scope')
  error.status = 404
  throw error
}

const zAddMember = z.object({ personId: z.string().min(1), role: zMembershipRole.default('MEMBER') })
const zChangeRole = z.object({ membershipId: z.string().min(1), role: zMembershipRole })
const zRemoveMember = z.object({ membershipId: z.string().min(1) })

export function membershipScopeForWorkspace(workspace) {
  if (!workspace?.tenantId) throw new Error('Project workspace is missing tenant scope')
  return workspace.businessId
    ? { tenantId: workspace.tenantId, OR: [{ businessId: workspace.businessId }, { businessId: null }] }
    : { tenantId: workspace.tenantId }
}

function mutableMembershipWhere(workspace, membershipId) {
  if (!workspace.businessId) throw new Error('Group project team memberships are read-only')
  return { id: membershipId, tenantId: workspace.tenantId, businessId: workspace.businessId }
}

async function projectWorkspace(db, projectId) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: { workspace: true } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  // The direct Project owner is authoritative; the fallback keeps old test
  // doubles/read snapshots usable during the additive backfill.
  return {
    ...project.workspace,
    businessId: project.businessId === undefined ? project.workspace.businessId : project.businessId,
  }
}

export async function listProjectTeam(projectId, { db = prisma, viewer } = {}) {
  const workspace = await projectWorkspace(db, projectId)
  assertTeamReadable(workspace.businessId, viewer)
  const memberships = await db.membership.findMany({
    where: membershipScopeForWorkspace(workspace),
    orderBy: { createdAt: 'asc' },
    include: { person: { select: { id: true, code: true, displayName: true, email: true } } },
  })
  const teamPersonIds = new Set(memberships.map((membership) => membership.personId))
  const [loads, people] = await Promise.all([
    Promise.all(
      memberships.map(async (membership) => ({
        membershipId: membership.id,
        activeWorkItems: await db.workItem.count({
          where: { deletedAt: null, assigneeRef: membership.personId, workstream: { projectId } },
        }),
      })),
    ),
    // Scoped to the project's tenant. This was an unfiltered `findMany`, so the
    // picker handed every Person in the database — name, code and email —
    // to anyone who could open any project's Team tab. Same shape as the FR-062
    // read leak (.brain/rca/2026-08-17-read-scope-outran-the-write-scope.md):
    // a read that was wider than anything it fronted.
    // No `email`: the picker renders `displayName · code` and nothing else, so
    // sending an address for every Person in the tenant hands out contact
    // details the surface never shows. Same rule as FR-062/SDD-035 — a response
    // carries no field its surface displays. `members` below keeps `email`
    // precisely because the roster line does render it.
    db.person.findMany({
      where: { memberships: { some: { tenantId: workspace.tenantId } } },
      orderBy: { displayName: 'asc' },
      select: { id: true, code: true, displayName: true },
    }),
  ])
  const loadByMembershipId = new Map(loads.map((load) => [load.membershipId, load.activeWorkItems]))
  return {
    businessId: workspace.businessId,
    workspace: { id: workspace.id, businessId: workspace.businessId, tenantId: workspace.tenantId },
    members: memberships.map((membership) => ({
      ...membership,
      activeWorkItems: loadByMembershipId.get(membership.id) || 0,
      mutable: Boolean(workspace.businessId && membership.businessId === workspace.businessId),
    })),
    availablePeople: people.filter((person) => !teamPersonIds.has(person.id)),
  }
}

export async function addProjectTeamMember(projectId, input, { db = prisma, viewer } = {}) {
  const { personId, role } = zAddMember.parse(input)
  const workspace = await projectWorkspace(db, projectId)
  if (!workspace.businessId) throw new Error('Group project team memberships are read-only')
  assertTeamWritable(workspace.businessId, viewer)
  const person = await db.person.findUnique({ where: { id: personId } })
  if (!person) throw new Error('Person not found')
  const existing = await db.membership.findFirst({ where: { personId, ...membershipScopeForWorkspace(workspace) } })
  if (existing) throw new Error('Person is already in this project scope')
  const membership = await db.membership.create({
    data: { personId, tenantId: workspace.tenantId, businessId: workspace.businessId, role },
    include: { person: { select: { id: true, code: true, displayName: true, email: true } } },
  })
  await recordAudit(db, { entityType: 'PROJECT', entityId: projectId, action: 'TEAM_MEMBER_ADDED', payload: { membershipId: membership.id, personId, role } })
  return membership
}

export async function changeProjectTeamRole(projectId, input, { db = prisma, viewer } = {}) {
  const { membershipId, role } = zChangeRole.parse(input)
  const workspace = await projectWorkspace(db, projectId)
  assertTeamWritable(workspace.businessId, viewer)
  const membership = await db.membership.findFirst({ where: mutableMembershipWhere(workspace, membershipId) })
  if (!membership) throw new Error('Membership is not mutable in this project scope')
  const updated = await db.membership.update({ where: { id: membershipId }, data: { role } })
  await recordAudit(db, { entityType: 'PROJECT', entityId: projectId, action: 'TEAM_ROLE_CHANGED', payload: { membershipId, role } })
  return updated
}

export async function removeProjectTeamMember(projectId, input, { db = prisma, viewer } = {}) {
  const { membershipId } = zRemoveMember.parse(input)
  const workspace = await projectWorkspace(db, projectId)
  assertTeamWritable(workspace.businessId, viewer)
  const membership = await db.membership.findFirst({ where: mutableMembershipWhere(workspace, membershipId) })
  if (!membership) throw new Error('Membership is not mutable in this project scope')
  await db.membership.delete({ where: { id: membershipId } })
  await recordAudit(db, { entityType: 'PROJECT', entityId: projectId, action: 'TEAM_MEMBER_REMOVED', payload: { membershipId, personId: membership.personId } })
  return { id: membershipId }
}
