// @req SEC-034 — ADR-093 D6, TASK-ZAI-113: an OWNER records a legal hold on one
//   Customer's chat evidence archive — a dispute reason and an end date — that
//   defers the archive key's destruction past its normal point (a PDPA erasure,
//   or the D5 term expiry) until the hold ends.
// @spec ADR-093 D6; SEC-034; BR-001
// @tested tests/integration/crm-archive-legal-hold.test.js
import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'

export const zRecordArchiveLegalHold = z.object({
  businessId: z.string().min(1),
  // @req ADR-093 D6 — "a dispute reason". Free text, the same shape as the
  //   retrieval route's caseReference: whatever the Business's own dispute
  //   file calls the matter, never validated against another registry.
  reason: z.string().trim().min(1).max(1000),
  endDate: z.string().date(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Every currently-active hold on this Customer (endDate in the future,
 * compared against `now`). A Customer may have accumulated several rows over
 * time; more than one can be active at once (an OWNER extending or stacking
 * protection), so this returns all of them rather than assuming one.
 */
export async function activeLegalHolds(db, { customerId, now = new Date() } = {}) {
  return db.archiveLegalHold.findMany({
    where: { customerId, endDate: { gt: now } },
    orderBy: { endDate: 'desc' },
  })
}

/**
 * Record one legal hold on a Customer's chat evidence archive, on the
 * authority of a Business owner in the Customer's tenant (BR-001) — the same
 * shape customer-consent-service.js and the retrieval route use.
 *
 * @param {string} customerId
 * @param {{businessId: string, reason: string, endDate: string}} input
 * @param {{viewer: object, db?: object}} ctx
 */
export async function recordArchiveLegalHold(customerId, input, { viewer, db = prisma } = {}) {
  if (!customerId) throw failure(400, 'CUSTOMER_ID_REQUIRED')
  const data = zRecordArchiveLegalHold.parse(input)

  const endDate = new Date(`${data.endDate}T23:59:59.999Z`)
  if (endDate.getTime() <= Date.now()) throw failure(400, 'END_DATE_MUST_BE_IN_THE_FUTURE')

  // Same order as customer-consent-service.js: domain visibility before
  // ownership, so a principal never granted CRM in this Business learns
  // nothing about whether it exists from the ownership refusal.
  assertDomainVisible(viewer, data.businessId, 'customer')
  if (!ownsBusiness(viewer, data.businessId)) {
    throw failure(403, 'Recording a legal hold requires owner authority over this Business')
  }

  const business = await db.business.findUnique({ where: { id: data.businessId }, select: { id: true, tenantId: true } })
  if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')

  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId: business.tenantId },
    select: { id: true, tenantId: true },
  })
  if (!customer) throw failure(404, 'CUSTOMER_NOT_FOUND')

  const actorId = viewer?.principal?.id ?? null
  if (!actorId) throw failure(401, 'AUTH_REQUIRED')

  return db.$transaction(async (tx) => {
    const hold = await tx.archiveLegalHold.create({
      data: {
        tenantId: customer.tenantId, customerId: customer.id,
        reason: data.reason, endDate, recordedByPersonId: actorId,
      },
    })
    await recordAudit(tx, {
      entityType: 'ARCHIVE',
      entityId: customer.id,
      action: 'ARCHIVE_LEGAL_HOLD_RECORDED',
      actorId,
      tenantId: customer.tenantId,
      businessId: data.businessId,
      reason: data.reason,
      payload: { customerId: customer.id, endDate: endDate.toISOString() },
    })
    return { id: hold.id, customerId: customer.id, reason: hold.reason, endDate: hold.endDate.toISOString(), recordedByPersonId: actorId }
  })
}

/**
 * For each of these customerIds, destroy their CustomerArchiveKey UNLESS an
 * active legal hold protects it (ADR-093 D6). Called from inside the same
 * transaction that PDPA-erases the Person these customers belong to
 * (identity/erase-principal.js) — the same "each domain owns its own models,
 * called through its own contract export" shape `redactConversationContent-
 * ForCustomers` already uses there.
 *
 * @returns {Promise<{destroyedArchiveKeys: number, heldByLegalHold: string[]}>}
 */
export async function destroyArchiveKeysUnlessLegalHold(tx, { customerIds, now = new Date() } = {}) {
  if (!customerIds || customerIds.length === 0) return { destroyedArchiveKeys: 0, heldByLegalHold: [] }

  const holds = await tx.archiveLegalHold.findMany({
    where: { customerId: { in: customerIds }, endDate: { gt: now } },
    select: { customerId: true },
  })
  const heldByLegalHold = [...new Set(holds.map((hold) => hold.customerId))]
  const toDestroy = customerIds.filter((id) => !heldByLegalHold.includes(id))

  const destroyed = toDestroy.length
    ? await tx.customerArchiveKey.deleteMany({ where: { customerId: { in: toDestroy } } })
    : { count: 0 }

  return { destroyedArchiveKeys: destroyed.count, heldByLegalHold }
}
