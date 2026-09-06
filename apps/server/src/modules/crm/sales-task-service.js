import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { hasPermission, SALES_TASK_WRITE_PERMISSION } from '@/modules/identity/rbac'
import {
  SALES_TASK_ENTITY,
  dayKey,
  dueState,
  nextSalesTaskStatus,
  salesTaskCode,
  salesTaskSummary,
  zCreateSalesTask,
  zSalesTaskAction,
  zSalesTaskFields,
  zSalesTaskListQuery,
} from './sales-task-domain'

// @req FR-157 — the only writer of SalesTask, the crm charter's fifth narrow
//   writer: create a follow-up owed to a customer, list and read them with
//   their due state recomputed against today, and apply the versioned
//   actions — UPDATE the fields, ASSIGN a member, START, COMPLETE with an
//   outcome, CANCEL with a reason, REOPEN. Scope follows the crm pattern:
//   the `customer` domain gate first (FR-061 — a viewer without the CRM
//   learns nothing, FR-072), then Business OWNER or the SALES_REP binding
//   for a write (an honest 403 for a viewer who holds the domain). A task is
//   Business-scoped; its optional Customer and Conversation are reached
//   through the Business's Tenant only (BR-001 CRM sharing, the same bound
//   `conversation-read-model` reads through) and never through the payload;
//   its assignee must hold an ACTIVE Membership that covers the Business.
//   The human code `TSK-YYYYMMDD-NNN` is generated per Business per day.
//   Every write is one transaction, bumps `version` and appends one audit row.
// @spec ADR-064; ADR-054 D3/D4; BR-001; BR-002; SEC-001; FR-061; FR-072
// @tested tests/integration/fr157-sales-task.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const PERSON_SELECT = { id: true, code: true, displayName: true }
const SELECT = {
  id: true, code: true, tenantId: true, businessId: true, customerId: true, conversationId: true, assigneePersonId: true, createdByPersonId: true,
  title: true, description: true, type: true, priority: true, status: true, scheduleKind: true, dueDate: true, startDate: true, timeStart: true, timeEnd: true,
  outcome: true, completedAt: true, completedByPersonId: true, cancelledAt: true, cancelReason: true, createdAt: true, updatedAt: true, version: true,
  assignee: { select: PERSON_SELECT },
  customer: { select: { id: true, code: true, displayName: true } },
}

function toDto(row, now = new Date()) {
  const { assignee, customer, ...task } = row
  return { ...task, assignee: assignee ?? null, customer: customer ?? null, dueState: dueState(task, now) }
}

/** The crm scope: the `customer` domain on a Business the viewer may see (a 404 otherwise), then the Business's tenant. */
async function resolveScope(db, viewer, businessId, { write = false } = {}) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  if (!id) throw failure(404, 'Business not found')
  assertDomainVisible(viewer, id, 'customer')
  if (write && !(ownsBusiness(viewer, id) || hasPermission(viewer, id, SALES_TASK_WRITE_PERMISSION))) {
    throw failure(403, 'Writing sales tasks requires owner or SALES_REP authority over this Business')
  }
  const business = await db.business.findUnique({ where: { id }, select: { id: true, tenantId: true } })
  if (!business) throw failure(404, 'Business not found')
  return business
}

/** A Customer of the Business's tenant that the viewer may see; a shared (Business-less) Customer is visible to every Business of the tenant. */
async function requireCustomer(tx, viewer, business, customerId) {
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, tenantId: true, businessId: true, deletedAt: true } })
  if (!customer || customer.tenantId !== business.tenantId || customer.deletedAt) throw failure(422, 'CUSTOMER_NOT_FOUND')
  if (customer.businessId && !seesBusiness(viewer, customer.businessId)) throw failure(422, 'CUSTOMER_NOT_FOUND')
  return customer
}

async function requireConversation(tx, viewer, business, conversationId) {
  const conversation = await tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true, tenantId: true, businessId: true, customerId: true } })
  if (!conversation || conversation.tenantId !== business.tenantId) throw failure(422, 'CONVERSATION_NOT_FOUND')
  if (conversation.businessId && !seesBusiness(viewer, conversation.businessId)) throw failure(422, 'CONVERSATION_NOT_FOUND')
  return conversation
}

/** The assignee must be a Person with an ACTIVE Membership that covers this Business (directly or tenant-wide). */
async function requireAssignee(tx, business, personId) {
  const membership = await tx.membership.findFirst({
    where: { personId, tenantId: business.tenantId, status: 'ACTIVE', OR: [{ businessId: business.id }, { businessId: null }] },
    select: { id: true },
  })
  if (!membership) throw failure(422, 'ASSIGNEE_NOT_MEMBER')
  return personId
}

async function nextCode(tx, business, now) {
  const prefix = `TSK-${dayKey(now).replace(/-/g, '')}-`
  const count = await tx.salesTask.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let seq = count + 1; seq < count + 50; seq += 1) {
    const code = salesTaskCode(now, seq)
    const taken = await tx.salesTask.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!taken) return code
  }
  throw failure(409, 'SALES_TASK_CODE_EXHAUSTED')
}

export async function createSalesTask(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zCreateSalesTask.parse(input)
  const row = await db.$transaction(async (tx) => {
    const business = await resolveScope(tx, viewer, data.businessId, { write: true })
    let customerId = data.customerId ?? null
    if (customerId) await requireCustomer(tx, viewer, business, customerId)
    let conversationId = data.conversationId ?? null
    if (conversationId) {
      const conversation = await requireConversation(tx, viewer, business, conversationId)
      if (customerId && conversation.customerId !== customerId) throw failure(422, 'CONVERSATION_CUSTOMER_MISMATCH')
      customerId = customerId ?? conversation.customerId
    }
    const assigneePersonId = data.assigneePersonId ? await requireAssignee(tx, business, data.assigneePersonId) : null
    const code = await nextCode(tx, business, now)
    const created = await tx.salesTask.create({
      data: {
        code, tenantId: business.tenantId, businessId: business.id, customerId, conversationId, assigneePersonId,
        createdByPersonId: actor(viewer), title: data.title, description: data.description ?? null,
        type: data.type ?? 'FOLLOW_UP', priority: data.priority ?? 'NORMAL', scheduleKind: data.scheduleKind ?? 'SINGLE',
        dueDate: data.dueDate, startDate: data.startDate ?? null, timeStart: data.timeStart ?? null, timeEnd: data.timeEnd ?? null,
      },
      select: SELECT,
    })
    await recordAudit(tx, {
      entityType: SALES_TASK_ENTITY, entityId: created.id, action: 'SALES_TASK_CREATED', actorId: actor(viewer),
      payload: { businessId: business.id, code: created.code, type: created.type, priority: created.priority, dueDate: created.dueDate, customerId, conversationId, assigneePersonId },
    })
    return created
  })
  return toDto(row, now)
}

export async function listSalesTasks(query, { viewer, db = prisma, now = new Date() } = {}) {
  const q = zSalesTaskListQuery.parse(query)
  const business = await resolveScope(db, viewer, q.businessId)
  const assignee = q.assigneePersonId === 'me' ? actor(viewer) : q.assigneePersonId
  const where = {
    businessId: business.id,
    ...(q.status ? { status: q.status } : q.includeClosed ? {} : { status: { in: ['OPEN', 'IN_PROGRESS'] } }),
    ...(assignee ? { assigneePersonId: assignee } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.conversationId ? { conversationId: q.conversationId } : {}),
  }
  const rows = await db.salesTask.findMany({ where, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: q.limit ?? 200, select: SELECT })
  let tasks = rows.map((row) => toDto(row, now))
  if (q.due) tasks = tasks.filter((t) => t.dueState === q.due)
  const open = await db.salesTask.findMany({ where: { businessId: business.id, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { status: true, dueDate: true, assigneePersonId: true } })
  return { businessId: business.id, tasks, summary: salesTaskSummary(open, { now, viewerPersonId: actor(viewer) }) }
}

export async function getSalesTask(id, { viewer, db = prisma, now = new Date() } = {}) {
  const taskId = typeof id === 'string' ? id.trim() : ''
  if (!taskId) throw failure(404, 'Business not found')
  const row = await db.salesTask.findUnique({ where: { id: taskId }, select: SELECT })
  if (!row) throw failure(404, 'Business not found')
  assertDomainVisible(viewer, row.businessId, 'customer')
  return toDto(row, now)
}

const ACTIONS = Object.freeze({
  UPDATE: 'SALES_TASK_UPDATED', ASSIGN: 'SALES_TASK_ASSIGNED', START: 'SALES_TASK_STARTED',
  COMPLETE: 'SALES_TASK_COMPLETED', CANCEL: 'SALES_TASK_CANCELLED', REOPEN: 'SALES_TASK_REOPENED',
})

function fieldColumns(fields = {}) {
  const out = {}
  for (const key of ['title', 'description', 'type', 'priority', 'scheduleKind', 'dueDate', 'startDate', 'timeStart', 'timeEnd']) {
    if (fields[key] !== undefined) out[key] = fields[key]
  }
  return out
}

/** Apply one versioned action; compare-and-swap on (id, version). */
export async function applySalesTaskAction(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const taskId = typeof id === 'string' ? id.trim() : ''
  if (!taskId) throw failure(404, 'Business not found')
  const data = zSalesTaskAction.parse(input)
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.salesTask.findUnique({ where: { id: taskId }, select: SELECT })
    if (!row) throw failure(404, 'Business not found')
    const business = await resolveScope(tx, viewer, row.businessId, { write: true })
    if (row.version !== data.version) throw failure(409, 'SALES_TASK_VERSION_CONFLICT')
    const status = nextSalesTaskStatus(row.status, data.action)
    if (!status) throw failure(409, 'SALES_TASK_STATUS_INVALID')

    const change = { status }
    const payload = { businessId: row.businessId, code: row.code, from: { status: row.status }, to: { status } }
    switch (data.action) {
      case 'UPDATE': {
        const patch = fieldColumns(data.fields)
        const merged = { scheduleKind: row.scheduleKind, dueDate: row.dueDate, startDate: row.startDate, timeStart: row.timeStart, timeEnd: row.timeEnd }
        for (const key of Object.keys(merged)) if (patch[key] !== undefined) merged[key] = patch[key]
        // The schedule rules apply to the merged row, not to the partial input.
        zSalesTaskFields.pick({ scheduleKind: true, dueDate: true, startDate: true, timeStart: true, timeEnd: true }).superRefine((v, ctx) => {
          if (v.scheduleKind === 'RANGE' && !v.startDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'a RANGE task needs startDate' })
          if (v.scheduleKind === 'RANGE' && v.startDate && v.startDate > v.dueDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'dueDate must not precede startDate' })
          if (v.scheduleKind === 'SINGLE' && v.startDate) ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'a SINGLE task has no startDate' })
          if (v.timeStart && v.timeEnd && v.timeEnd <= v.timeStart) ctx.addIssue({ code: 'custom', path: ['timeEnd'], message: 'timeEnd must be after timeStart' })
        }).parse(merged)
        Object.assign(change, fieldColumns(data.fields))
        payload.fields = Object.keys(fieldColumns(data.fields))
        break
      }
      case 'ASSIGN':
        change.assigneePersonId = data.assigneePersonId ? await requireAssignee(tx, business, data.assigneePersonId) : null
        payload.from.assigneePersonId = row.assigneePersonId
        payload.to.assigneePersonId = change.assigneePersonId
        break
      case 'START':
        break
      case 'COMPLETE':
        change.completedAt = now
        change.completedByPersonId = actor(viewer)
        change.outcome = data.outcome ?? null
        payload.outcome = change.outcome
        break
      case 'CANCEL':
        change.cancelledAt = now
        change.cancelReason = data.reason ?? null
        payload.reason = change.cancelReason
        break
      case 'REOPEN':
        change.completedAt = null
        change.completedByPersonId = null
        change.outcome = null
        change.cancelledAt = null
        change.cancelReason = null
        break
      default:
        throw failure(400, 'SALES_TASK_ACTION_UNKNOWN')
    }
    const result = await tx.salesTask.updateMany({ where: { id: row.id, version: row.version }, data: { ...change, version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'SALES_TASK_VERSION_CONFLICT')
    await recordAudit(tx, { entityType: SALES_TASK_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: actor(viewer), payload: { ...payload, version: row.version + 1 } })
    return tx.salesTask.findUnique({ where: { id: row.id }, select: SELECT })
  })
  return toDto(updated, now)
}
