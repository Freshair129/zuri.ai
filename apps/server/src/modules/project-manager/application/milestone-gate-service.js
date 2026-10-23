import { withPipelineTransaction, isPipelineTransaction } from './pipeline-transaction'
import { assertPipelineEndpointRetained } from './pipeline-state'
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

const codeExists = (model, db = prisma) => async (code) =>
  Boolean(await db[model].findUnique({ where: { code } }))

export async function createMilestone(input, { viewer, db = prisma } = {}) {
  if (!isPipelineTransaction(db)) return withPipelineTransaction(db, tx => createMilestone(input, { viewer, db: tx }))
  const data = zMilestoneInput.parse(input)
  const project = await db.project.findUnique({ where: { id: data.projectId } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  await assertProjectWritable(viewer, data.projectId, { db })
  if (data.workstreamId) {
    const ws = await db.workstream.findUnique({ where: { id: data.workstreamId } })
    if (!ws || ws.projectId !== data.projectId) throw new Error('Workstream must belong to the same project')
  }
  const code = data.code || (await uniqueHumanCode('MS', data.title, codeExists('milestone', db)))
  const milestone = await db.milestone.create({
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
  await recordAudit(db, { entityType: 'MILESTONE', entityId: milestone.id, action: 'CREATED', payload: { code } })
  return milestone
}

export async function updateMilestone(id, patch, { viewer, db = prisma } = {}) {
  if (!isPipelineTransaction(db)) return withPipelineTransaction(db, tx => updateMilestone(id, patch, { viewer, db: tx }))
  const existing = await db.milestone.findUnique({ where: { id } })
  if (!existing) throw new Error('Milestone not found')
  await assertProjectWritable(viewer, existing.projectId, { db, notFoundMessage: 'Milestone not found' })
  const completedAt =
    patch.status === 'DONE' && existing.status !== 'DONE'
      ? new Date()
      : patch.completedAt === undefined
        ? existing.completedAt
        : patch.completedAt
  const milestone = await db.milestone.update({
    where: { id },
    data: {
      title: patch.title ?? existing.title,
      status: patch.status ?? existing.status,
      weight: patch.weight ?? existing.weight,
      targetAt: patch.targetAt === undefined ? existing.targetAt : patch.targetAt,
      completedAt,
    },
  })
  await recordAudit(db, { entityType: 'MILESTONE', entityId: id, action: 'UPDATED', payload: patch })
  return milestone
}

export async function createGate(input, { viewer, db = prisma } = {}) {
  if (!isPipelineTransaction(db)) return withPipelineTransaction(db, tx => createGate(input, { viewer, db: tx }))
  const data = zGateInput.parse(input)
  const project = await db.project.findUnique({ where: { id: data.projectId } })
  if (!project || project.deletedAt) throw new Error('Project not found')
  await assertProjectWritable(viewer, data.projectId, { db })
  if (data.workstreamId) {
    const ws = await db.workstream.findUnique({ where: { id: data.workstreamId } })
    if (!ws || ws.projectId !== data.projectId) throw new Error('Workstream must belong to the same project')
  }
  const code = data.code || (await uniqueHumanCode('GATE', data.title, codeExists('gate', db)))
  const gate = await db.gate.create({
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
  await recordAudit(db, { entityType: 'GATE', entityId: gate.id, action: 'CREATED', payload: { code } })
  return gate
}

export async function updateGate(id, patch, { viewer, db = prisma } = {}) {
  if (!isPipelineTransaction(db)) return withPipelineTransaction(db, tx => updateGate(id, patch, { viewer, db: tx }))
  const existing = await db.gate.findUnique({ where: { id } })
  if (!existing) throw new Error('Gate not found')
  await assertProjectWritable(viewer, existing.projectId, { db, notFoundMessage: 'Gate not found' })
  const gate = await db.gate.update({
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
  await recordAudit(db, { entityType: 'GATE', entityId: id, action: 'UPDATED', payload: patch })
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
export async function listMilestonesAndGates({ projectId, workstreamId, businessId } = {}) {
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
  if (businessId) {
    const projectScope = { businessId, deletedAt: null }
    whereM.project = projectScope
    whereG.project = projectScope
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
