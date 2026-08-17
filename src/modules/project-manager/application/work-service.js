import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { zWorkContainerInput, zWorkItemInput, zWorkItemUpdate } from '@/lib/validation/entities'
import { recordAudit, safeParse } from './audit'
import { activeWorkstream } from './active-filters'
import { assertWorkstreamWritable } from './project-authorization'

// @req FR-005 — neutral WorkContainer/WorkItem model behind all execution modes
// @req FR-007 — the global browser lists the same population progress counts
// @spec BR-004
// @tested tests/integration/project-core.test.js, tests/integration/work-listing-scope.test.js
// @req FR-072 — mutations refuse the write unless the viewer owns the Business
// governing the target Workstream's Project.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-work-service-authorization.test.js

const codeExists = (model) => async (code) =>
  Boolean(await prisma[model].findUnique({ where: { code } }))

export function hydrateItem(item) {
  return {
    ...item,
    metrics: safeParse(item.metricDataJson),
    metadata: safeParse(item.metadataJson),
  }
}

export function hydrateContainer(container) {
  return { ...container, metadata: safeParse(container.metadataJson) }
}

// ---- Containers ------------------------------------------------------------

export async function createContainer(input, { viewer } = {}) {
  const data = zWorkContainerInput.parse(input)
  const ws = await prisma.workstream.findUnique({ where: { id: data.workstreamId } })
  if (!ws || ws.deletedAt) throw new Error('Workstream not found')
  await assertWorkstreamWritable(viewer, data.workstreamId)
  if (data.parentId) {
    const parent = await prisma.workContainer.findUnique({ where: { id: data.parentId } })
    if (!parent || parent.workstreamId !== data.workstreamId) {
      throw new Error('Parent container must belong to the same workstream')
    }
  }
  const code = data.code || (await uniqueHumanCode('WC', data.title, codeExists('workContainer')))
  const container = await prisma.workContainer.create({
    data: {
      code,
      workstreamId: data.workstreamId,
      parentId: data.parentId ?? null,
      subtype: data.subtype,
      title: data.title,
      status: data.status || 'PLANNED',
      startAt: data.startAt ?? null,
      targetAt: data.targetAt ?? null,
      metadataJson: JSON.stringify(data.metadata || {}),
    },
  })
  await recordAudit(prisma, { entityType: 'WORK_CONTAINER', entityId: container.id, action: 'CREATED', payload: { code, subtype: data.subtype } })
  return container
}

export async function updateContainer(id, patch, { viewer } = {}) {
  const existing = await prisma.workContainer.findUnique({ where: { id } })
  if (!existing) throw new Error('Container not found')
  await assertWorkstreamWritable(viewer, existing.workstreamId, { notFoundMessage: 'Container not found' })
  const container = await prisma.workContainer.update({
    where: { id },
    data: {
      title: patch.title ?? existing.title,
      status: patch.status ?? existing.status,
      subtype: patch.subtype ?? existing.subtype,
      startAt: patch.startAt === undefined ? existing.startAt : patch.startAt,
      targetAt: patch.targetAt === undefined ? existing.targetAt : patch.targetAt,
      metadataJson: patch.metadata ? JSON.stringify(patch.metadata) : existing.metadataJson,
      version: { increment: 1 },
    },
  })
  await recordAudit(prisma, { entityType: 'WORK_CONTAINER', entityId: id, action: 'UPDATED', payload: patch })
  return container
}

// ---- Items -----------------------------------------------------------------

export async function createItem(input, { viewer } = {}) {
  const data = zWorkItemInput.parse(input)
  const ws = await prisma.workstream.findUnique({ where: { id: data.workstreamId } })
  if (!ws || ws.deletedAt) throw new Error('Workstream not found')
  await assertWorkstreamWritable(viewer, data.workstreamId)
  if (data.containerId) {
    const container = await prisma.workContainer.findUnique({ where: { id: data.containerId } })
    if (!container || container.workstreamId !== data.workstreamId) {
      throw new Error('Container must belong to the same workstream')
    }
  }
  const code = data.code || (await uniqueHumanCode('WI', data.title, codeExists('workItem')))
  const item = await prisma.workItem.create({
    data: {
      code,
      workstreamId: data.workstreamId,
      containerId: data.containerId ?? null,
      subtype: data.subtype,
      title: data.title,
      status: data.status || 'PLANNED',
      assigneeRef: data.assigneeRef ?? null,
      weight: data.weight ?? 1,
      numericValue: data.numericValue ?? null,
      probability: data.probability ?? null,
      metricDataJson: JSON.stringify(data.metrics || {}),
      metadataJson: JSON.stringify(data.metadata || {}),
      startAt: data.startAt ?? null,
      targetAt: data.targetAt ?? null,
    },
  })
  await recordAudit(prisma, { entityType: 'WORK_ITEM', entityId: item.id, action: 'CREATED', payload: { code, subtype: data.subtype } })
  return item
}

export async function updateItem(id, patch, { viewer } = {}) {
  const data = zWorkItemUpdate.parse(patch)
  const existing = await prisma.workItem.findUnique({ where: { id } })
  if (!existing || existing.deletedAt) throw new Error('Work item not found')
  await assertWorkstreamWritable(viewer, existing.workstreamId, { notFoundMessage: 'Work item not found' })
  const item = await prisma.workItem.update({
    where: { id },
    data: {
      title: data.title ?? existing.title,
      status: data.status ?? existing.status,
      subtype: data.subtype ?? existing.subtype,
      containerId: data.containerId === undefined ? existing.containerId : data.containerId,
      assigneeRef: data.assigneeRef === undefined ? existing.assigneeRef : data.assigneeRef,
      weight: data.weight ?? existing.weight,
      numericValue: data.numericValue === undefined ? existing.numericValue : data.numericValue,
      probability: data.probability === undefined ? existing.probability : data.probability,
      metricDataJson: data.metrics ? JSON.stringify({ ...safeParse(existing.metricDataJson), ...data.metrics }) : existing.metricDataJson,
      metadataJson: data.metadata ? JSON.stringify({ ...safeParse(existing.metadataJson), ...data.metadata }) : existing.metadataJson,
      startAt: data.startAt === undefined ? existing.startAt : data.startAt,
      targetAt: data.targetAt === undefined ? existing.targetAt : data.targetAt,
      version: { increment: 1 },
    },
  })
  await recordAudit(prisma, { entityType: 'WORK_ITEM', entityId: id, action: 'UPDATED', payload: data })
  return item
}

export async function deleteItem(id, { viewer } = {}) {
  const existing = await prisma.workItem.findUnique({ where: { id } })
  if (!existing || existing.deletedAt) {
    const error = new Error('Work item not found')
    error.status = 404
    throw error
  }
  await assertWorkstreamWritable(viewer, existing.workstreamId, { notFoundMessage: 'Work item not found' })
  const item = await prisma.workItem.update({
    where: { id },
    data: { deletedAt: new Date(), status: 'CANCELLED', version: { increment: 1 } },
  })
  await recordAudit(prisma, { entityType: 'WORK_ITEM', entityId: id, action: 'DELETED' })
  return item
}

/**
 * How many work items one listing will return.
 *
 * @req FR-005 — the cap is disclosed, not silent. It was a bare `take: 500` and
 * the caller had no way to learn it had been applied, which matters more here
 * than in most lists: `AllWorkView` filters its search box **client-side over
 * the rows it received**, so past 500 items a search returned "no results" for
 * work that exists. A silent cap turns into a wrong answer, not a short page.
 */
export const WORK_LIST_LIMIT = 500

/**
 * @returns {Promise<{items: object[], limit: number, truncated: boolean}>}
 *   `truncated` is decided by asking for one row more than we will return —
 *   the only way to know there is a next row without counting the whole table.
 */
export async function listWork({ workstreamId, projectId, subtype, status, q, executionMode } = {}) {
  const where = { deletedAt: null }
  if (workstreamId) where.workstreamId = workstreamId
  if (subtype) where.subtype = subtype
  if (status) where.status = status
  if (q) where.OR = [{ title: { contains: q } }, { code: { contains: q } }]
  // @req FR-007 — an archived or soft-deleted workstream's items are excluded,
  // because every progress calculator already excludes them. Listing them here
  // (with an inline status editor) offered edits that could not move any number
  // the app displays. `activeWorkstream()` is the one definition of that.
  where.workstream = { ...activeWorkstream() }
  if (projectId) where.workstream.projectId = projectId
  if (executionMode) where.workstream.executionMode = executionMode

  const rows = await prisma.workItem.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      workstream: {
        select: { id: true, code: true, name: true, executionMode: true, projectId: true, project: { select: { id: true, code: true, name: true } } },
      },
      container: { select: { id: true, code: true, title: true, subtype: true } },
    },
    take: WORK_LIST_LIMIT + 1,
  })
  return {
    items: rows.slice(0, WORK_LIST_LIMIT).map(hydrateItem),
    limit: WORK_LIST_LIMIT,
    truncated: rows.length > WORK_LIST_LIMIT,
  }
}
