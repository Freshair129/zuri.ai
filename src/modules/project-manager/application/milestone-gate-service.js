import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { zMilestoneInput, zGateInput } from '@/lib/validation/entities'
import { recordAudit, safeParse } from './audit'

// @req FR-006 — weighted milestones + required gates with evidence
// @tested tests/integration/project-core.test.js

const codeExists = (model) => async (code) =>
  Boolean(await prisma[model].findUnique({ where: { code } }))

export async function createMilestone(input) {
  const data = zMilestoneInput.parse(input)
  const project = await prisma.project.findUnique({ where: { id: data.projectId } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  if (data.workstreamId) {
    const ws = await prisma.workstream.findUnique({ where: { id: data.workstreamId } })
    if (!ws || ws.projectId !== data.projectId) throw new Error('Workstream must belong to the same project')
  }
  const code = data.code || (await uniqueHumanCode('MS', data.title, codeExists('milestone')))
  const milestone = await prisma.milestone.create({
    data: {
      code,
      projectId: data.projectId,
      workstreamId: data.workstreamId ?? null,
      title: data.title,
      status: data.status || 'PLANNED',
      weight: data.weight ?? 1,
      targetAt: data.targetAt ?? null,
      completedAt: data.completedAt ?? null,
    },
  })
  await recordAudit(prisma, { entityType: 'MILESTONE', entityId: milestone.id, action: 'CREATED', payload: { code } })
  return milestone
}

export async function updateMilestone(id, patch) {
  const existing = await prisma.milestone.findUnique({ where: { id } })
  if (!existing) throw new Error('Milestone not found')
  const completedAt =
    patch.status === 'DONE' && existing.status !== 'DONE'
      ? new Date()
      : patch.completedAt === undefined
        ? existing.completedAt
        : patch.completedAt
  const milestone = await prisma.milestone.update({
    where: { id },
    data: {
      title: patch.title ?? existing.title,
      status: patch.status ?? existing.status,
      weight: patch.weight ?? existing.weight,
      targetAt: patch.targetAt === undefined ? existing.targetAt : patch.targetAt,
      completedAt,
    },
  })
  await recordAudit(prisma, { entityType: 'MILESTONE', entityId: id, action: 'UPDATED', payload: patch })
  return milestone
}

export async function createGate(input) {
  const data = zGateInput.parse(input)
  const project = await prisma.project.findUnique({ where: { id: data.projectId } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  if (data.workstreamId) {
    const ws = await prisma.workstream.findUnique({ where: { id: data.workstreamId } })
    if (!ws || ws.projectId !== data.projectId) throw new Error('Workstream must belong to the same project')
  }
  const code = data.code || (await uniqueHumanCode('GATE', data.title, codeExists('gate')))
  const gate = await prisma.gate.create({
    data: {
      code,
      projectId: data.projectId,
      workstreamId: data.workstreamId ?? null,
      title: data.title,
      status: data.status || 'OPEN',
      required: data.required ?? true,
      evidenceJson: JSON.stringify(data.evidence || {}),
      targetAt: data.targetAt ?? null,
    },
  })
  await recordAudit(prisma, { entityType: 'GATE', entityId: gate.id, action: 'CREATED', payload: { code } })
  return gate
}

export async function updateGate(id, patch) {
  const existing = await prisma.gate.findUnique({ where: { id } })
  if (!existing) throw new Error('Gate not found')
  const gate = await prisma.gate.update({
    where: { id },
    data: {
      title: patch.title ?? existing.title,
      status: patch.status ?? existing.status,
      required: patch.required ?? existing.required,
      evidenceJson: patch.evidence
        ? JSON.stringify({ ...safeParse(existing.evidenceJson), ...patch.evidence })
        : existing.evidenceJson,
      targetAt: patch.targetAt === undefined ? existing.targetAt : patch.targetAt,
    },
  })
  await recordAudit(prisma, { entityType: 'GATE', entityId: id, action: 'UPDATED', payload: patch })
  return gate
}

export async function listMilestonesAndGates({ projectId, workstreamId } = {}) {
  const whereM = {}
  const whereG = {}
  if (projectId) {
    whereM.projectId = projectId
    whereG.projectId = projectId
  }
  if (workstreamId) {
    whereM.workstreamId = workstreamId
    whereG.workstreamId = workstreamId
  }
  const [milestones, gates] = await Promise.all([
    prisma.milestone.findMany({
      where: whereM,
      orderBy: [{ targetAt: 'asc' }, { code: 'asc' }],
      include: { project: { select: { code: true, name: true } }, workstream: { select: { code: true, name: true } } },
    }),
    prisma.gate.findMany({
      where: whereG,
      orderBy: [{ targetAt: 'asc' }, { code: 'asc' }],
      include: { project: { select: { code: true, name: true } }, workstream: { select: { code: true, name: true } } },
    }),
  ])
  return { milestones, gates: gates.map((g) => ({ ...g, evidence: safeParse(g.evidenceJson) })) }
}
