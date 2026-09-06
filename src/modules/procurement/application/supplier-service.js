import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { SUPPLIER_ENTITY, zCreateSupplier, zSupplierAction, zSupplierListQuery } from '../domain/procurement'
import { loadBusiness, notFound } from './procurement-authority'

// @req FR-160 — the only writer of Supplier: create one for the Business with
//   a human `code` unique per Tenant (an attribute, BR-002 — the internal id
//   is the key), the contact and terms as plain attributes; UPDATE the fields
//   and ARCHIVE (the row stays; an archived supplier takes no new order).
//   Compare-and-swap on `version`; one transaction and one audit row per
//   write; the procurement domain gate then OWNER or PROCUREMENT_BUYER, every
//   refusal of scope the FR-072 404.
// @spec ADR-066; BR-002; SEC-001; FR-072
// @tested tests/integration/fr160-procurement.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const SELECT = {
  id: true, code: true, tenantId: true, businessId: true, name: true, taxId: true, contactName: true, phone: true, email: true, address: true,
  paymentTerms: true, leadTimeDays: true, notes: true, status: true, archivedAt: true, createdAt: true, updatedAt: true, version: true,
  _count: { select: { purchaseOrders: true } },
}

const toDto = ({ _count, ...row }) => ({ ...row, purchaseOrders: _count?.purchaseOrders ?? 0 })

export async function createSupplier(input, { viewer, db = prisma } = {}) {
  const data = zCreateSupplier.parse(input)
  const row = await db.$transaction(async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { capability: 'po' })
    const taken = await tx.supplier.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code: data.code } }, select: { id: true } })
    if (taken) throw failure(409, 'SUPPLIER_CODE_TAKEN')
    const { businessId, ...fields } = data
    const created = await tx.supplier.create({ data: { ...fields, tenantId: business.tenantId, businessId: business.id }, select: SELECT })
    await recordAudit(tx, { entityType: SUPPLIER_ENTITY, entityId: created.id, action: 'SUPPLIER_CREATED', actorId: actor(viewer), payload: { businessId: business.id, code: created.code, name: created.name } })
    return created
  })
  return toDto(row)
}

export async function listSuppliers(query, { viewer, db = prisma } = {}) {
  const q = zSupplierListQuery.parse(query)
  const business = await loadBusiness(db, viewer, q.businessId)
  const rows = await db.supplier.findMany({
    where: { businessId: business.id, ...(q.includeArchived ? {} : { status: 'ACTIVE' }) },
    orderBy: [{ status: 'asc' }, { code: 'asc' }],
    select: SELECT,
  })
  return rows.map(toDto)
}

export async function getSupplier(id, { viewer, db = prisma } = {}) {
  const supplierId = typeof id === 'string' ? id.trim() : ''
  if (!supplierId) throw notFound()
  const row = await db.supplier.findUnique({ where: { id: supplierId }, select: SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return toDto(row)
}

const ACTIONS = Object.freeze({ UPDATE: 'SUPPLIER_UPDATED', ARCHIVE: 'SUPPLIER_ARCHIVED' })

/** Apply one versioned action; compare-and-swap on (id, version). */
export async function applySupplierAction(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const supplierId = typeof id === 'string' ? id.trim() : ''
  if (!supplierId) throw notFound()
  const data = zSupplierAction.parse(input)
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.supplier.findUnique({ where: { id: supplierId }, select: SELECT })
    if (!row) throw notFound()
    const business = await loadBusiness(tx, viewer, row.businessId, { capability: 'po' })
    if (row.version !== data.version) throw failure(409, 'SUPPLIER_VERSION_CONFLICT')
    if (row.status === 'ARCHIVED') throw failure(409, 'SUPPLIER_STATUS_INVALID')
    const change = {}
    const payload = { businessId: business.id, code: row.code }
    if (data.action === 'UPDATE') {
      Object.assign(change, data.fields)
      payload.fields = Object.keys(data.fields)
    } else if (data.action === 'ARCHIVE') {
      change.status = 'ARCHIVED'
      change.archivedAt = now
      payload.reason = data.reason ?? null
    } else {
      throw failure(400, 'SUPPLIER_ACTION_UNKNOWN')
    }
    const result = await tx.supplier.updateMany({ where: { id: row.id, version: row.version }, data: { ...change, version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'SUPPLIER_VERSION_CONFLICT')
    await recordAudit(tx, { entityType: SUPPLIER_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: actor(viewer), payload: { ...payload, version: row.version + 1 } })
    return tx.supplier.findUnique({ where: { id: row.id }, select: SELECT })
  })
  return toDto(updated)
}
