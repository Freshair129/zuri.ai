// @req FR-157 — sales tasks against a real database: the generated code, the
//   links to a Customer and Conversation reached only through the Business's
//   tenant, the assignee's membership, the authority ladder (domain gate then
//   OWNER / SALES_REP), the schedule rules, the versioned actions and the due
//   state and summary recomputed against a given "now".
// @spec ADR-064; ADR-054 D3/D4; BR-001; BR-002; SEC-001; FR-061; FR-072
// @tested tests/integration/fr157-sales-task.test.js
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ROLE_SALES_REP } from '@/modules/identity/rbac'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { applySalesTaskAction, createSalesTask, getSalesTask, listSalesTasks } from '@/modules/crm/sales-task-service'

const NOW = new Date('2026-09-06T03:00:00Z') // 10:00 in Bangkok
const CRM = ['projects', 'platform', 'customer']
let tenantA, busA1, busA2, tenantB, busB1, owner, rep, member, noDomain, repPerson, outsider
let convA1, customerA1, convA2, customerB1

async function person(code) {
  return prisma.person.create({ data: { id: randomUUID(), code: `PER-TASK-${code}-${randomUUID().slice(0, 6)}`, displayName: `Person ${code}` } })
}

async function viewerFor(personRow, over) {
  return makeViewer({ ...over, principal: { id: personRow.id, code: personRow.code, displayName: personRow.displayName } })
}

describe('FR-157 SalesTask', () => {
  beforeAll(async () => {
    const pfA = await createPortfolio({ name: 'Task Group A', code: 'PF-TASK-A' })
    tenantA = await createTenant({ portfolioId: pfA.id, name: 'Task Tenant A', code: 'TNT-TASK-A' })
    busA1 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านขาย', code: 'BUS-TASK-A1' })
    busA2 = await createBusiness({ tenantId: tenantA.id, name: 'ร้านพี่น้อง', code: 'BUS-TASK-A2' })
    const pfB = await createPortfolio({ name: 'Task Group B', code: 'PF-TASK-B' })
    tenantB = await createTenant({ portfolioId: pfB.id, name: 'Task Tenant B', code: 'TNT-TASK-B' })
    busB1 = await createBusiness({ tenantId: tenantB.id, name: 'ร้านอื่น', code: 'BUS-TASK-B1' })

    const ownerPerson = await person('OWNER')
    repPerson = await person('REP')
    const memberPerson = await person('MEMBER')
    outsider = await person('OUTSIDER')
    await prisma.membership.create({ data: { personId: ownerPerson.id, tenantId: tenantA.id, businessId: busA1.id, role: 'OWNER', status: 'ACTIVE' } })
    await prisma.membership.create({ data: { personId: repPerson.id, tenantId: tenantA.id, businessId: busA1.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: JSON.stringify(['customer']) } })
    await prisma.membership.create({ data: { personId: memberPerson.id, tenantId: tenantA.id, businessId: null, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: JSON.stringify(['customer']) } })

    owner = await viewerFor(ownerPerson, { visibleBusinessIds: [busA1.id, busA2.id], ownedBusinessIds: [busA1.id, busA2.id], visibleDomains: [...VIEWER_DOMAINS] })
    rep = await viewerFor(repPerson, { visibleBusinessIds: [busA1.id], ownedBusinessIds: [], visibleDomains: CRM, rolesByBusinessId: { [busA1.id]: [ROLE_SALES_REP] } })
    member = await viewerFor(memberPerson, { visibleBusinessIds: [busA1.id], ownedBusinessIds: [], visibleDomains: CRM })
    noDomain = await viewerFor(memberPerson, { visibleBusinessIds: [busA1.id], ownedBusinessIds: [busA1.id], visibleDomains: ['projects'] })

    const a1 = await ingestLineMessage({ tenantId: tenantA.id, businessId: busA1.id, lineUserId: 'U-task-a1', displayName: 'ลูกค้า เอ', threadId: 'TH-TASK-A1', text: 'สนใจครับ', externalMessageId: 'MT-1' })
    convA1 = a1.conversationId; customerA1 = a1.customerId
    const a2 = await ingestLineMessage({ tenantId: tenantA.id, businessId: busA2.id, lineUserId: 'U-task-a2', displayName: 'ลูกค้า สอง', threadId: 'TH-TASK-A2', text: 'ขอราคา', externalMessageId: 'MT-2' })
    convA2 = a2.conversationId
    const b1 = await ingestLineMessage({ tenantId: tenantB.id, businessId: busB1.id, lineUserId: 'U-task-b1', displayName: 'ลูกค้า บี', threadId: 'TH-TASK-B1', text: 'สอบถาม', externalMessageId: 'MT-3' })
    customerB1 = b1.customerId
  })

  const create = (over = {}, viewer = owner, now = NOW) => createSalesTask({ businessId: busA1.id, title: 'โทรติดตามใบเสนอราคา', dueDate: '2026-09-06', ...over }, { viewer, now })

  it('AC-157.1 — creates with a generated TSK-YYYYMMDD-NNN code, defaults, and the due state against now', async () => {
    const first = await create({}, rep)
    expect(first).toMatchObject({ code: 'TSK-20260906-001', businessId: busA1.id, tenantId: tenantA.id, type: 'FOLLOW_UP', priority: 'NORMAL', status: 'OPEN', scheduleKind: 'SINGLE', dueState: 'TODAY', version: 1, createdByPersonId: repPerson.id, assignee: null, customer: null })
    const second = await create({ type: 'CALL', priority: 'URGENT', timeStart: '14:00', timeEnd: '14:30' })
    expect(second).toMatchObject({ code: 'TSK-20260906-002', type: 'CALL', priority: 'URGENT', timeStart: '14:00', timeEnd: '14:30' })
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'SALES_TASK', entityId: first.id } })
    expect(audits.map((a) => a.action)).toEqual(['SALES_TASK_CREATED'])
  })

  it('AC-157.2 — links reach a Customer and Conversation through the tenant only; the assignee must be a member', async () => {
    const linked = await create({ conversationId: convA1 })
    expect(linked.customerId).toBe(customerA1)
    expect(linked.customer).toMatchObject({ id: customerA1, displayName: 'ลูกค้า เอ' })
    await expect(create({ customerId: customerB1 })).rejects.toMatchObject({ status: 422, message: 'CUSTOMER_NOT_FOUND' })
    await expect(create({ conversationId: convA1, customerId: customerB1 })).rejects.toMatchObject({ status: 422, message: 'CUSTOMER_NOT_FOUND' })
    const sibling = await create({ conversationId: convA2 })
    expect(sibling.conversationId).toBe(convA2)
    await expect(create({ conversationId: convA2, customerId: customerA1 })).rejects.toMatchObject({ status: 422, message: 'CONVERSATION_CUSTOMER_MISMATCH' })
    await expect(create({ conversationId: 'no-such' })).rejects.toMatchObject({ status: 422, message: 'CONVERSATION_NOT_FOUND' })
    await expect(create({ assigneePersonId: outsider.id })).rejects.toMatchObject({ status: 422, message: 'ASSIGNEE_NOT_MEMBER' })
    const assigned = await create({ assigneePersonId: repPerson.id })
    expect(assigned.assignee).toMatchObject({ id: repPerson.id, displayName: 'Person REP' })
  })

  it('AC-157.3 — the authority ladder: the customer domain gate is a 404, then OWNER or SALES_REP writes, members read', async () => {
    await expect(listSalesTasks({ businessId: busA1.id }, { viewer: member, now: NOW })).resolves.toMatchObject({ businessId: busA1.id })
    await expect(create({}, member)).rejects.toMatchObject({ status: 403 })
    await expect(listSalesTasks({ businessId: busA1.id }, { viewer: noDomain, now: NOW })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(create({}, noDomain)).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(listSalesTasks({ businessId: busB1.id }, { viewer: owner, now: NOW })).rejects.toMatchObject({ status: 404 })
    await expect(getSalesTask('no-such-task', { viewer: owner })).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    const task = await create({}, rep)
    await expect(getSalesTask(task.id, { viewer: member, now: NOW })).resolves.toMatchObject({ id: task.id })
    await expect(applySalesTaskAction(task.id, { action: 'START', version: 1 }, { viewer: member })).rejects.toMatchObject({ status: 403 })
  })

  it('AC-157.4 — the schedule rules apply to the merged row on UPDATE', async () => {
    const task = await create({ scheduleKind: 'RANGE', startDate: '2026-09-01', dueDate: '2026-09-10' })
    expect(task).toMatchObject({ scheduleKind: 'RANGE', dueState: 'UPCOMING' })
    await expect(applySalesTaskAction(task.id, { action: 'UPDATE', version: 1, fields: { dueDate: '2026-08-30' } }, { viewer: owner, now: NOW })).rejects.toThrow(/precede/)
    const updated = await applySalesTaskAction(task.id, { action: 'UPDATE', version: 1, fields: { scheduleKind: 'SINGLE', startDate: null, dueDate: '2026-09-05', title: 'นัดเดโม' } }, { viewer: owner, now: NOW })
    expect(updated).toMatchObject({ scheduleKind: 'SINGLE', startDate: null, title: 'นัดเดโม', dueState: 'OVERDUE', version: 2 })
    await expect(create({ scheduleKind: 'RANGE' })).rejects.toThrow(/needs startDate/)
  })

  it('AC-157.5 — versioned actions walk the status machine, keep the row, and audit every step', async () => {
    const task = await create({ assigneePersonId: repPerson.id })
    const started = await applySalesTaskAction(task.id, { action: 'START', version: 1 }, { viewer: rep, now: NOW })
    expect(started).toMatchObject({ status: 'IN_PROGRESS', version: 2 })
    await expect(applySalesTaskAction(task.id, { action: 'START', version: 2 }, { viewer: rep })).rejects.toMatchObject({ status: 409, message: 'SALES_TASK_STATUS_INVALID' })
    await expect(applySalesTaskAction(task.id, { action: 'COMPLETE', version: 1 }, { viewer: rep })).rejects.toMatchObject({ status: 409, message: 'SALES_TASK_VERSION_CONFLICT' })
    const done = await applySalesTaskAction(task.id, { action: 'COMPLETE', version: 2, outcome: 'ลูกค้าตกลงสั่ง 50 ชุด' }, { viewer: rep, now: NOW })
    expect(done).toMatchObject({ status: 'DONE', outcome: 'ลูกค้าตกลงสั่ง 50 ชุด', completedByPersonId: repPerson.id, dueState: 'NONE', version: 3 })
    expect(done.completedAt).toBeTruthy()
    await expect(applySalesTaskAction(task.id, { action: 'UPDATE', version: 3, fields: { title: 'x' } }, { viewer: rep })).rejects.toMatchObject({ status: 409, message: 'SALES_TASK_STATUS_INVALID' })
    const reopened = await applySalesTaskAction(task.id, { action: 'REOPEN', version: 3 }, { viewer: owner, now: NOW })
    expect(reopened).toMatchObject({ status: 'OPEN', outcome: null, completedAt: null, completedByPersonId: null, version: 4 })
    const unassigned = await applySalesTaskAction(task.id, { action: 'ASSIGN', version: 4, assigneePersonId: null }, { viewer: owner, now: NOW })
    expect(unassigned.assigneePersonId).toBeNull()
    await expect(applySalesTaskAction(task.id, { action: 'ASSIGN', version: 5, assigneePersonId: outsider.id }, { viewer: owner })).rejects.toMatchObject({ status: 422, message: 'ASSIGNEE_NOT_MEMBER' })
    const cancelled = await applySalesTaskAction(task.id, { action: 'CANCEL', version: 5, reason: 'ลูกค้ายกเลิก' }, { viewer: owner, now: NOW })
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'ลูกค้ายกเลิก', version: 6 })
    expect(await prisma.salesTask.findUnique({ where: { id: task.id }, select: { id: true } })).toBeTruthy()
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'SALES_TASK', entityId: task.id }, orderBy: { occurredAt: 'asc' } })
    expect(audits.map((a) => a.action)).toEqual(['SALES_TASK_CREATED', 'SALES_TASK_STARTED', 'SALES_TASK_COMPLETED', 'SALES_TASK_REOPENED', 'SALES_TASK_ASSIGNED', 'SALES_TASK_CANCELLED'])
  })

  it('AC-157.6 — the list filters by due state and assignee, hides closed tasks unless asked, and the summary counts open work', async () => {
    const business = await createBusiness({ tenantId: tenantA.id, name: 'ร้านสรุป', code: 'BUS-TASK-SUM' })
    await prisma.membership.create({ data: { personId: repPerson.id, tenantId: tenantA.id, businessId: business.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: JSON.stringify(['customer']) } })
    const boss = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: CRM, principal: { id: repPerson.id, code: repPerson.code, displayName: repPerson.displayName } })
    const mk = (over) => createSalesTask({ businessId: business.id, title: over.title, dueDate: over.dueDate, ...(over.assigneePersonId ? { assigneePersonId: over.assigneePersonId } : {}) }, { viewer: boss, now: NOW })
    const late = await mk({ title: 'late', dueDate: '2026-09-01', assigneePersonId: repPerson.id })
    await mk({ title: 'today', dueDate: '2026-09-06' })
    await mk({ title: 'soon', dueDate: '2026-09-09' })
    const closed = await mk({ title: 'closed', dueDate: '2026-09-02' })
    await applySalesTaskAction(closed.id, { action: 'COMPLETE', version: 1 }, { viewer: boss, now: NOW })

    const all = await listSalesTasks({ businessId: business.id }, { viewer: boss, now: NOW })
    expect(all.tasks.map((t) => t.title)).toEqual(['late', 'today', 'soon'])
    expect(all.summary).toEqual({ open: 3, inProgress: 0, overdue: 1, dueToday: 1, mine: 1, unassigned: 2 })
    expect((await listSalesTasks({ businessId: business.id, due: 'OVERDUE' }, { viewer: boss, now: NOW })).tasks.map((t) => t.id)).toEqual([late.id])
    expect((await listSalesTasks({ businessId: business.id, due: 'TODAY' }, { viewer: boss, now: NOW })).tasks.map((t) => t.title)).toEqual(['today'])
    expect((await listSalesTasks({ businessId: business.id, assigneePersonId: 'me' }, { viewer: boss, now: NOW })).tasks.map((t) => t.id)).toEqual([late.id])
    expect((await listSalesTasks({ businessId: business.id, includeClosed: true }, { viewer: boss, now: NOW })).tasks.map((t) => t.title)).toEqual(['late', 'closed', 'today', 'soon'])
    expect((await listSalesTasks({ businessId: business.id, status: 'DONE' }, { viewer: boss, now: NOW })).tasks.map((t) => t.title)).toEqual(['closed'])
  })
})
