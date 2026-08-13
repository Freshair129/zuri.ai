// @req FR-036 — project-context membership list, business-scoped mutations, and assignee load.
// @spec SDD-015, BR-001, SEC-003, docs/features/FR-036-project-team.md
// @tested tests/unit/project-team-service.test.js
import prisma from '@/lib/db'
import { z } from 'zod'
import { zMembershipRole } from '@/lib/validation/enums'
import { recordAudit } from './audit'

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

export async function listProjectTeam(projectId, { db = prisma } = {}) {
  const workspace = await projectWorkspace(db, projectId)
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
    db.person.findMany({ orderBy: { displayName: 'asc' }, select: { id: true, code: true, displayName: true, email: true } }),
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

export async function addProjectTeamMember(projectId, input, { db = prisma } = {}) {
  const { personId, role } = zAddMember.parse(input)
  const workspace = await projectWorkspace(db, projectId)
  if (!workspace.businessId) throw new Error('Group project team memberships are read-only')
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

export async function changeProjectTeamRole(projectId, input, { db = prisma } = {}) {
  const { membershipId, role } = zChangeRole.parse(input)
  const workspace = await projectWorkspace(db, projectId)
  const membership = await db.membership.findFirst({ where: mutableMembershipWhere(workspace, membershipId) })
  if (!membership) throw new Error('Membership is not mutable in this project scope')
  const updated = await db.membership.update({ where: { id: membershipId }, data: { role } })
  await recordAudit(db, { entityType: 'PROJECT', entityId: projectId, action: 'TEAM_ROLE_CHANGED', payload: { membershipId, role } })
  return updated
}

export async function removeProjectTeamMember(projectId, input, { db = prisma } = {}) {
  const { membershipId } = zRemoveMember.parse(input)
  const workspace = await projectWorkspace(db, projectId)
  const membership = await db.membership.findFirst({ where: mutableMembershipWhere(workspace, membershipId) })
  if (!membership) throw new Error('Membership is not mutable in this project scope')
  await db.membership.delete({ where: { id: membershipId } })
  await recordAudit(db, { entityType: 'PROJECT', entityId: projectId, action: 'TEAM_MEMBER_REMOVED', payload: { membershipId, personId: membership.personId } })
  return { id: membershipId }
}
