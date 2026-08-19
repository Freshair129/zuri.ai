import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { zMilestoneInput, zGateInput } from '@/lib/validation/entities'
import { recordAudit, safeParse } from './audit'
import { assertProjectWritable } from './project-authorization'

// @req FR-006 — weighted milestones + required gates with evidence
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/project-core.test.js
// @tested tests/integration/fr072-milestone-gate-authorization.test.js
// @tested tests/unit/global-view-drilldown.test.js — pins the `project` select,
// which the global view's drill-down link reads its href key from.

const codeExists = (model) => async (code) =>
  Boolean(await prisma[model].findUnique({ where: { code } }))

export async function createMilestone(input, { viewer } = {}) {
  const data = zMilestoneInput.parse(input)
  const project = await prisma.project.findUnique({ where: { id: data.projectId } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  await assertProjectWritable(viewer, data.projectId)
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

export async function updateMilestone(id, patch, { viewer } = {}) {
  const existing = await prisma.milestone.findUnique({ where: { id } })
  if (!existing) throw new Error('Milestone not found')
  await assertProjectWritable(viewer, existing.projectId, { notFoundMessage: 'Milestone not found' })
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

export async function createGate(input, { viewer } = {}) {
  const data = zGateInput.parse(input)
  const project = await prisma.project.findUnique({ where: { id: data.projectId } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  await assertProjectWritable(viewer, data.projectId)
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

export async function updateGate(id, patch, { viewer } = {}) {
  const existing = await prisma.gate.findUnique({ where: { id } })
  if (!existing) throw new Error('Gate not found')
  await assertProjectWritable(viewer, existing.projectId, { notFoundMessage: 'Gate not found' })
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

/**
 * @req FR-006 — the read behind both scopes of the Milestones & Gates browser.
 *
 * `project.select` carries `id` as well as `code`, because the global instance
 * renders that code as the drill-down into the project-scoped instance and
 * needs the key to build the href. The row's own `projectId` scalar does arrive
 * (the top-level `include` returns every scalar), but the view must not depend
 * on an undeclared field: an explicit `select` is a second place the shape is
 * declared and it does not fail loudly when it falls behind
 * (`.brain/rca/2026-08-16-narrow-select-dropped-fields-silently.md`). Selecting
 * `id` next to `code` matches `listWork`, whose `workstream.project` select
 * already carries all three — one drill-down reading its key from two
 * structurally different places is how that incident started.
 *
 * Widening is additive: the sole consumer is `GET /api/milestones`, whose sole
 * consumer is `MilestonesView`. No caller can break from a key appearing.
 */
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
      include: { project: { select: { id: true, code: true, name: true } }, workstream: { select: { code: true, name: true } } },
    }),
    prisma.gate.findMany({
      where: whereG,
      orderBy: [{ targetAt: 'asc' }, { code: 'asc' }],
      include: { project: { select: { id: true, code: true, name: true } }, workstream: { select: { code: true, name: true } } },
    }),
  ])
  return { milestones, gates: gates.map((g) => ({ ...g, evidence: safeParse(g.evidenceJson) })) }
}
