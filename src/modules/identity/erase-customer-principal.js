import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness, isInstallationOperator } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { erasePrincipal } from '@/modules/identity/erase-principal'

// @req FR-022 — the production trigger for PDPA erasure. `erasePrincipal` has been
//   correct and unreachable: no route, UI or script could run it, so a real erasure
//   request could only be answered by hand in a database console.
// @req FR-103 — the authority shape is the consent writer's, not a new one. Same
//   per-Business OWNER grant, same "resolve the Customer through the owned
//   Business's tenant" lookup (BR-001), so a Customer id alone can never widen the
//   action past the tenant the caller actually owns into.
// @spec SEC-001, SEC-005, SEC-003, BR-001, SDD-048
// @tested tests/integration/crm-customer-erasure.test.js, tests/unit/customer-erasure-confirmation.test.js
//
// WHY THE REFUSALS ARE ALL 404
// ----------------------------
// The consent writer answers 403 for a Business the caller merely sees, because the
// existence of that Business is already known to them — they are looking at it. This
// action is different in one way that matters: it is destructive and irreversible, so
// the interesting question an attacker asks is not "may I?" but "is there a Customer
// with this id?". Every refusal here therefore has the shape of not-found (FR-072):
// unowned Business, unknown Business, another tenant's Customer and a fabricated id
// are one answer. Nothing about the target leaks from a refusal.
//
// WHY A TYPED CONFIRMATION AND NOT A FLAG
// ---------------------------------------
// `{ confirmation: 'ERASE' }` is checked before anything is looked up, so it is a
// property of the request rather than of the caller's luck: a mis-wired client, a
// replayed body or a fat-fingered curl cannot erase a person by accident. It is the
// one place in this codebase where a literal must be typed, and the reason is that
// there is no undo.

const CONFIRMATION = 'ERASE'

export const zCustomerErasureRequest = z.object({
  businessId: z.string().min(1).optional(),
  confirmation: z.string(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

const notFound = () => failure(404, 'CUSTOMER_NOT_FOUND')

/**
 * Erase the principal behind one Customer, on the authority of a Business owner in
 * that Customer's tenant (or of the installation operator).
 *
 * @param {string} customerId
 * @param {{businessId?: string, confirmation: string}} input
 * @param {{viewer: object, db?: object}} ctx
 * @returns {Promise<{customerId: string, counts: object}>} counts only — never any
 *   personal data, since the caller has just asserted they may not hold it.
 */
export async function eraseCustomerPrincipal(customerId, input, { viewer, db = prisma } = {}) {
  if (!customerId) throw failure(400, 'CUSTOMER_ID_REQUIRED')
  const data = zCustomerErasureRequest.parse(input)

  // First, before any lookup: a request that does not confirm is a malformed request,
  // not a refusal about a particular Customer.
  if (data.confirmation !== CONFIRMATION) {
    throw failure(400, `การลบถาวรต้องพิมพ์คำว่า ${CONFIRMATION} เพื่อยืนยัน`)
  }

  const operator = isInstallationOperator(viewer)
  if (!operator) {
    if (!data.businessId) throw failure(400, 'BUSINESS_ID_REQUIRED')
    // FR-061/062 — the domain gate runs BEFORE the ownership gate (same order as
    // the consent writer): a principal never granted the CRM in this Business must
    // not learn from the ownership refusal that the Business is real. Both answer
    // 404-shaped, so the order changes what is disclosed, not the status.
    assertDomainVisible(viewer, data.businessId, 'customer')
    if (!ownsBusiness(viewer, data.businessId)) throw notFound()
  }

  let tenantId = null
  if (data.businessId) {
    const business = await db.business.findUnique({
      where: { id: data.businessId },
      select: { id: true, tenantId: true },
    })
    if (!business) throw notFound()
    tenantId = business.tenantId
  }

  const customer = await db.customer.findFirst({
    // The operator alone may act without naming a Business; everyone else is bounded
    // by the tenant of the Business they own, exactly as `recordCustomerConsent` is.
    where: { id: customerId, ...(tenantId ? { tenantId } : {}) },
    select: { id: true, tenantId: true, personId: true },
  })
  if (!customer) throw notFound()

  const counts = await erasePrincipal({
    tenantId: customer.tenantId,
    personId: customer.personId,
    // A fixed reason, never caller text: the audit payload is the one record of this
    // action that survives it, and a free-text field on an erasure is exactly where
    // personal data gets re-introduced.
    reason: 'PDPA_ERASURE_REQUEST',
  })

  return { customerId: customer.id, counts }
}
