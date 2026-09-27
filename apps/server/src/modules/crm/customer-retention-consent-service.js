import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { hasPermission, RETENTION_CONSENT_WRITE_PERMISSION } from '@/modules/identity/rbac'
import { destroyLegalHoldArchiveKeys, withLockedCustomer } from './chat-evidence-archive-service'
import { customersWithActiveRetentionConsent, findActiveRetentionConsent } from './retention-consent-reader'

export { customersWithActiveRetentionConsent, findActiveRetentionConsent }

// @req FR-022 — "consent to retain = keep" (owner ruling 2026-09-27, ADR-093
//   1.2.0). Sales asks the customer first; the customer agrees to retention; a
//   sales user records that agreement here. Chat evidence that an erasure or the
//   retention sweep would otherwise destroy is kept only while such a consent is
//   active — see chat-evidence-hold-reseal-service.js (erasure of another member
//   of a held Customer's shared thread) and chat-evidence-archive-service.js
//   (deferred lines past the retention window).
// @spec ADR-093 1.2.0, FR-022, BR-001, SEC-003
// @tested tests/integration/crm-retention-consent.test.js
//
// WHY THIS IS NOT Customer.consentStatus (FR-103)
// ------------------------------------------------
// FR-103 is the Business OWNER's attestation of PDPA processing consent, and
// its GRANTED value also gates marketing broadcasts. Retaining evidence is a
// different purpose with a different writer (a sales user, not only the owner);
// folding it into that column would make a customer who declines marketing lose
// retention, or the reverse. So it is its own history table.
//
// ONE WRITER, CHECKED AT USE TIME
// --------------------------------
// This module is the only writer of CustomerRetentionConsent. Readers
// (`customersWithActiveRetentionConsent`) query it inside the erasure or sweep
// that needs the answer — never a cached flag. Revocation and the destruction of
// the held Customer's legal-hold re-seal keys happen in one transaction, under
// the same Customer lock an erasure takes before it re-seals under that hold, so
// a re-seal can never commit against a consent that was already revoked.

const MAX_NOTE = 1000

export const zRetentionConsentInput = z.object({
  businessId: z.string().min(1),
  note: z.string().trim().min(1).max(MAX_NOTE).optional(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function summary(row) {
  return {
    id: row.id,
    customerId: row.customerId,
    businessId: row.businessId,
    recordedByPersonId: row.recordedByPersonId,
    recordedAt: row.recordedAt.toISOString(),
    note: row.note ?? null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedByPersonId: row.revokedByPersonId ?? null,
  }
}

/**
 * Revoke every active retention consent of one Customer and destroy the
 * legal-hold re-seal keys held for them, inside the caller's transaction (the
 * caller holds the Customer's lock). Audited whenever anything was revoked or
 * destroyed (or always, with `alwaysAudit`, for an explicit revoke). `clearNote` is the erasure path: the note may describe the person.
 *
 * @returns {Promise<{revoked: number, destroyedHoldKeys: string[], auditEventId: string|null}>}
 */
export async function revokeRetentionConsentInTransaction(tx, {
  tenantId, customerId, now = new Date(), actorId = null, actorType = 'LOCAL_USER',
  businessId = null, reason, clearNote = false, alwaysAudit = false,
}) {
  const revoked = await tx.customerRetentionConsent.updateMany({
    where: { tenantId, customerId, revokedAt: null },
    data: { revokedAt: now, revokedByPersonId: actorId },
  })
  if (clearNote) {
    await tx.customerRetentionConsent.updateMany({ where: { tenantId, customerId, note: { not: null } }, data: { note: null } })
  }
  const destroyedHoldKeys = await destroyLegalHoldArchiveKeys(tx, { tenantId, heldCustomerId: customerId })
  if (!alwaysAudit && revoked.count === 0 && destroyedHoldKeys.length === 0) return { revoked: 0, destroyedHoldKeys, auditEventId: null }
  const audit = await recordAudit(tx, {
    entityType: 'CUSTOMER',
    entityId: customerId,
    action: 'CUSTOMER_RETENTION_CONSENT_REVOKED',
    actorType,
    actorId,
    tenantId,
    businessId,
    reason,
    payload: { customerId, tenantId, revoked: revoked.count, destroyedHoldKeys, reason },
  })
  return { revoked: revoked.count, destroyedHoldKeys, auditEventId: audit.id }
}

async function resolveWriteScope(db, viewer, customerId, businessId) {
  if (!customerId) throw failure(400, 'CUSTOMER_ID_REQUIRED')
  // FR-061 — domain visibility before authority, so a principal never granted
  // the CRM here learns nothing about whether the Business exists.
  assertDomainVisible(viewer, businessId, 'customer')
  if (!(ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, RETENTION_CONSENT_WRITE_PERMISSION))) {
    throw failure(403, 'Recording retention consent requires owner or SALES_REP authority over this Business')
  }
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
  if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')
  // BR-001 — tenant-bound: never widened past this Business's tenant by the payload.
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId: business.tenantId },
    select: { id: true, tenantId: true, deletedAt: true },
  })
  if (!customer) throw failure(404, 'CUSTOMER_NOT_FOUND')
  const actorId = viewer?.principal?.id ?? null
  if (typeof actorId !== 'string' || !actorId) throw failure(401, 'AUTH_REQUIRED')
  return { business, customer, actorId }
}

/**
 * A sales user (SALES_REP, or the Business OWNER) records that this Customer
 * agreed, in advance, to have their chat evidence retained. Idempotent: an
 * already-active consent is returned unchanged rather than duplicated.
 *
 * @param {string} customerId
 * @param {{businessId: string, note?: string}} input
 * @param {{viewer: object, db?: object, now?: Date, correlationId?: string}} ctx
 */
export async function recordCustomerRetentionConsent(customerId, input, { viewer, db = prisma, now = new Date(), correlationId } = {}) {
  const data = zRetentionConsentInput.parse(input)
  const { business, customer, actorId } = await resolveWriteScope(db, viewer, customerId, data.businessId)
  if (customer.deletedAt) throw failure(409, 'CUSTOMER_ERASED')

  return withLockedCustomer(db, { tenantId: customer.tenantId, customerId: customer.id, now }, async (tx) => {
    const existing = await findActiveRetentionConsent(tx, { tenantId: customer.tenantId, customerId: customer.id })
    if (existing) return { ...summary(existing), alreadyActive: true, auditEventId: null }
    const row = await tx.customerRetentionConsent.create({
      data: {
        tenantId: customer.tenantId,
        customerId: customer.id,
        businessId: business.id,
        recordedByPersonId: actorId,
        recordedAt: now,
        note: data.note ?? null,
      },
    })
    const audit = await recordAudit(tx, {
      entityType: 'CUSTOMER',
      entityId: customer.id,
      action: 'CUSTOMER_RETENTION_CONSENT_GRANTED',
      actorId,
      tenantId: customer.tenantId,
      businessId: business.id,
      payload: {
        customerId: customer.id, tenantId: customer.tenantId, businessId: business.id, consentId: row.id,
        ...(correlationId ? { correlationId } : {}),
      },
    })
    return { ...summary(row), alreadyActive: false, auditEventId: audit.id }
  })
}

/**
 * Revoke this Customer's retention consent, on the same authority that records
 * it. In the same transaction every legal-hold re-seal key held for this
 * Customer is destroyed: evidence kept because this Customer consented is kept
 * no longer than that consent.
 */
export async function revokeCustomerRetentionConsent(customerId, input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zRetentionConsentInput.parse(input)
  const { business, customer, actorId } = await resolveWriteScope(db, viewer, customerId, data.businessId)

  return withLockedCustomer(db, { tenantId: customer.tenantId, customerId: customer.id, now }, async (tx) => {
    const result = await revokeRetentionConsentInTransaction(tx, {
      tenantId: customer.tenantId, customerId: customer.id, now, actorId,
      businessId: business.id, reason: data.note ?? 'REVOKED_BY_SALES', alwaysAudit: true,
    })
    return { customerId: customer.id, ...result }
  })
}
