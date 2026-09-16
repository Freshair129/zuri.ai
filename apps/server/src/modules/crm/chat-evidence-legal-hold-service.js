import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req SEC-034 — an OWNER records a legal hold on a Customer's chat evidence
//   archive (ADR-093 D6, TASK-ZAI-113): an open dispute, its reason and an end
//   date. While the hold is unexpired, a later PDPA erasure of this Customer
//   leaves their archive data key alone instead of destroying it — see
//   `destroyCustomerArchiveKey` in `chat-evidence-archive-service.js`, the one
//   function that checks this.
// @spec ADR-093 D6, SEC-034, BR-001, SEC-003
// @tested tests/integration/crm-archive-legal-hold.test.js
//
// WHY NO AAL2 STEP-UP HERE, UNLIKE RETRIEVAL (ADR-093 D7)
// ---------------------------------------------------------
// `chat-evidence-retrieval-service.js` requires AAL2 because it decrypts and
// returns a Customer's actual archived words — reading personal content is
// exactly what the step-up gate exists to slow down. Recording a hold reads or
// exposes no customer content at all: it writes a reason string and a date the
// OWNER already knows, and its effect is to make a LATER erasure defer rather
// than to grant access to anything now. ADR-093 D6 names AAL2 only for D7
// retrieval, not for recording a hold, and the operation it gates — PDPA
// erasure itself (`eraseCustomerPrincipal`) — has never required AAL2 either
// (BR-001 OWNER authority plus a typed confirmation is that flow's own bar).
// Requiring a stronger gate here than on the erasure it defers would be
// inconsistent in the wrong direction. OWNER authority, a mandatory non-empty
// reason, a mandatory future end date and an audit event are the bar this
// module holds instead — the same shape `recordCustomerConsent` uses for
// another CRM record no AAL2 step-up gates.
//
// WHY THIS IS A HISTORY WITH NO EDIT OR EARLY-END PATH
// -------------------------------------------------------
// ADR-093 D6 describes only recording a hold with a reason and an end date; it
// never describes an OWNER ending one early. This module deliberately has no
// such function: `CustomerLegalHold` rows are created, never updated, and
// "active" is derived from `now < endDate` wherever it is read
// (`findActiveLegalHold`). A Customer may accumulate more than one hold over
// time (sequential disputes), so a second recording is additive, never a
// replacement of the first.

const CUSTOMER_LEGAL_HOLD_MAX_REASON = 2000

export const zRecordCustomerLegalHold = z.object({
  businessId: z.string().min(1),
  // @req ADR-093 D6 — "an open dispute, its reason": free text the OWNER
  //   supplies, the same style as chat-evidence-retrieval-service.js's
  //   caseReference — whatever the Business's own dispute file calls it,
  //   never a code this system validates against a registry.
  reason: z.string().trim().min(1).max(CUSTOMER_LEGAL_HOLD_MAX_REASON),
  endDate: z.string().date(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

const notFound = () => failure(404, 'CUSTOMER_NOT_FOUND')

/**
 * Record a legal hold on one Customer, on the authority of a Business owner in
 * that Customer's tenant (BR-001) — same shape as `eraseCustomerPrincipal` and
 * `retrieveArchivedChatEvidence`: domain visibility before ownership, so a
 * principal never granted the CRM in this Business learns nothing from the
 * ownership refusal about whether the Business exists.
 *
 * @param {string} customerId
 * @param {{businessId: string, reason: string, endDate: string}} input
 * @param {{viewer: object, db?: object, now?: Date}} ctx
 * @returns {Promise<{customerId: string, legalHoldId: string, reason: string, endDate: string, recordedAt: string}>}
 */
export async function recordCustomerLegalHold(customerId, input, { viewer, db = prisma, now = new Date() } = {}) {
  if (!customerId) throw failure(400, 'CUSTOMER_ID_REQUIRED')
  const data = zRecordCustomerLegalHold.parse(input)

  // The end date is a calendar day; a hold covers through the end of it, the
  // same "whole day" reading `chat-evidence-retrieval-service.js` gives a date
  // range's endDate. Checked before any lookup: a hold that is already expired
  // the moment it would be recorded is a malformed request, not a fact about a
  // particular Customer.
  const endDate = new Date(`${data.endDate}T23:59:59.999Z`)
  if (!(endDate.getTime() > now.getTime())) {
    throw failure(400, 'END_DATE_MUST_BE_IN_THE_FUTURE')
  }

  // FR-061/062 — the domain gate runs BEFORE the ownership gate: a principal
  // never granted the CRM in this Business must not learn from the ownership
  // refusal that the Business is real. Both answer 404-shaped.
  assertDomainVisible(viewer, data.businessId, 'customer')
  if (!ownsBusiness(viewer, data.businessId)) throw notFound()

  const business = await db.business.findUnique({
    where: { id: data.businessId },
    select: { id: true, tenantId: true },
  })
  if (!business) throw notFound()

  // BR-001 — the CRM is tenant-shared, so any Customer in this Business's
  // tenant is reachable; never widened to another tenant by anything the
  // caller supplies, because the lookup itself is bounded by it.
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId: business.tenantId },
    select: { id: true, tenantId: true },
  })
  if (!customer) throw notFound()

  const recordedByPersonId = viewer?.principal?.id ?? viewer?.personId
  if (typeof recordedByPersonId !== 'string' || !recordedByPersonId) throw failure(401, 'AUTH_REQUIRED')

  const hold = await db.customerLegalHold.create({
    data: {
      tenantId: customer.tenantId,
      customerId: customer.id,
      reason: data.reason,
      endDate,
      recordedByPersonId,
    },
  })

  await recordAudit(db, {
    entityType: 'ARCHIVE',
    entityId: customer.id,
    action: 'LEGAL_HOLD_RECORDED',
    actorId: recordedByPersonId,
    tenantId: customer.tenantId,
    businessId: data.businessId,
    reason: data.reason,
    payload: {
      customerId: customer.id,
      legalHoldId: hold.id,
      reason: data.reason,
      endDate: hold.endDate.toISOString(),
    },
  })

  return {
    customerId: customer.id,
    legalHoldId: hold.id,
    reason: hold.reason,
    endDate: hold.endDate.toISOString(),
    recordedAt: hold.createdAt.toISOString(),
  }
}
