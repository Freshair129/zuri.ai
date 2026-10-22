import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { eraseCustomerMemoryInTransaction } from '@/modules/identity/customer-memory-erasure'
import { removeUnreferencedArchiveFile } from './chat-evidence-archive-service'
import { recordErasureBlocked } from './chat-evidence-hold-reseal-service'

// @req FR-103 — SEC-005: a Business owner attests that a Customer's PDPA consent
//   was captured, and that attestation becomes a narrow, audited write — the crm
//   charter's "one writer per concern" pattern (reply-record-service is the sibling
//   example for FR-093), not a field the FR-023 ingest seam or the FR-091 read
//   model gets to set as a side effect of something else.
// @spec SDD-053, BR-001, SEC-005, SDD-048
// @tested tests/unit/customer-consent-service.test.js, tests/integration/crm-customer-consent.test.js,
//   tests/integration/domain-visibility-server.test.js, tests/integration/fr236-knowledge-candidate.test.js
// @req FR-232 — on DECLINED, erase this principal's Tier 1 memory projections
//   with the consent change in one transaction while retaining identity/login
//   and the independently authorized retention purpose.
//
// WHAT THIS DOES NOT DO
// ----------------------
// It does not gate AI processing, redact anything sent to a model provider, or
// answer the retention/provider-terms questions — those are the other open items
// in docs/domains/agent/ethics-governance.md (#1, #2, #3, #6), left open on
// purpose. A processing-consent decline erases the existing Tier 1 projections
// and records a pending Core-owned MSP request; external erasure remains pending
// until MSP returns a real receipt.

const ATTESTABLE_STATUSES = ['GRANTED', 'DECLINED']

export const zRecordCustomerConsent = z.object({
  businessId: z.string().min(1),
  status: z.enum(ATTESTABLE_STATUSES),
  note: z.string().trim().min(1).max(1000).optional(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function consentSummary(customer) {
  return {
    id: customer.id,
    code: customer.code,
    displayName: customer.displayName,
    consentStatus: customer.consentStatus,
    memoryErasureStatus: customer.memoryErasureStatus ?? 'NONE',
    consentRecordedAt: customer.consentRecordedAt ? customer.consentRecordedAt.toISOString() : null,
    consentRecordedByPersonId: customer.consentRecordedByPersonId,
    consentNote: customer.consentNote,
  }
}

/**
 * Record one Business owner's attestation of a Customer's PDPA consent status.
 *
 * `businessId` is the scope the caller must OWN — SEC-005 is a compliance action a
 * Business takes responsibility for, not a read a Member happens to have. It is
 * never taken from the Customer row itself: the row is only reached *through* this
 * Business's tenant (BR-001's CRM sharing), so naming a Customer that is merely
 * tenant-shared into view can never stand in for owning the Business asked for.
 *
 * @param {string} customerId
 * @param {{businessId: string, status: 'GRANTED'|'DECLINED', note?: string}} input
 * @param {{viewer: object, db?: object, correlationId?: string}} ctx
 */
export async function recordCustomerConsent(customerId, input, {
  viewer, db = prisma, correlationId, env = process.env, archiveBaseDir = undefined, alert = undefined,
} = {}) {
  if (!customerId) throw failure(400, 'CUSTOMER_ID_REQUIRED')
  const data = zRecordCustomerConsent.parse(input)

  // @req FR-061 — the domain gate runs BEFORE the ownership gate, and the order is the
  // point. A principal who was never granted the CRM in this Business must not learn
  // from the status code that the Business is real and merely unowned by them; they get
  // the same 404 an unknown Business gets (FR-072(a)). A principal who *does* hold the
  // domain but not ownership still gets the honest 403 below, which is what that
  // refusal is for.
  assertDomainVisible(viewer, data.businessId, 'customer')

  if (!ownsBusiness(viewer, data.businessId)) {
    throw failure(403, 'Recording consent requires owner authority over this Business')
  }

  const business = await db.business.findUnique({
    where: { id: data.businessId },
    select: { id: true, tenantId: true },
  })
  if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')

  // Tenant-scoped, exactly like conversation-read-model's resolveScope: the CRM is
  // shared across the Businesses of one tenant (BR-001), so any Customer in this
  // Business's tenant is reachable — never widened to another tenant by anything
  // the caller supplies, because the lookup itself is bounded by it.
  const customer = await db.customer.findFirst({
    where: { id: customerId, tenantId: business.tenantId },
    select: { id: true, personId: true, code: true, displayName: true, consentStatus: true, memoryErasureStatus: true },
  })
  if (!customer) throw failure(404, 'CUSTOMER_NOT_FOUND')

  const actorId = viewer?.principal?.id ?? null

  const recordedAt = new Date()
  let resealFile = null
  try {
    return await db.$transaction(async (tx) => {
      if (data.status === 'DECLINED') {
        // The Customer's Person is derived from the tenant-scoped row above.
        // Identity composes CRM, LINE, raw-record, and Knowledge-owned ports;
        // no identity/login or retention-purpose rows are revoked here.
        const memory = await eraseCustomerMemoryInTransaction(tx, {
          tenantId: business.tenantId,
          personId: customer.personId,
          reason: 'CONSENT_DECLINED',
          now: recordedAt,
          viewer,
          env,
          archiveBaseDir,
          preserveCustomerHolds: true,
          includeArchivedCustomerLines: false,
        })
        resealFile = memory.resealFile
      }

      const audit = await recordAudit(tx, {
        entityType: 'CUSTOMER',
        entityId: customer.id,
        action: `CUSTOMER_CONSENT_${data.status}`,
        actorId,
        // @spec SDD-048 — no message content and no raw contact detail here; the
        //   payload is exactly what a PDPA request needs answered, nothing the
        //   observability emitter's allowlist would ever have to strip.
        payload: {
          businessId: data.businessId,
          tenantId: business.tenantId,
          previousStatus: customer.consentStatus,
          status: data.status,
          ...(correlationId ? { correlationId } : {}),
        },
      })

      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: {
          consentStatus: data.status,
          consentRecordedAt: recordedAt,
          consentRecordedByPersonId: actorId,
          consentNote: data.note ?? null,
          version: { increment: 1 },
        },
      })

      return { ...consentSummary(updated), auditEventId: audit.id }
    }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 })
  } catch (error) {
    if (!resealFile && error?.archiveFile) resealFile = error.archiveFile
    if (resealFile) {
      await removeUnreferencedArchiveFile(db, {
        tenantId: business.tenantId,
        runId: resealFile.runId,
        relativePath: resealFile.relativePath,
        baseDir: resealFile.baseDir,
      })
    }
    if (error?.code === 'ERASURE_BLOCKED_ARCHIVE_CHAIN_INVALID') {
      await recordErasureBlocked(db, error, alert ? { alert } : {})
    }
    throw error
  }
}
