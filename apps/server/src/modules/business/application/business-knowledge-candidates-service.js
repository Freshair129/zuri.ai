// @req FR-236 — the only writer of Business.knowledgeCandidatesEnabled. An
//   OWNER of the target Business turns LINE FAQ knowledge candidate drafting
//   on or off; everything else about the Business is untouched, and the
//   write is one versioned, audited transaction (BR-001, SEC-003) — the same
//   shape as business-capability-service.js (FR-169) and
//   business-strategy-mutation-service.js.
//
//   OWNER-only, not operator-only: TASK-ZAI-099's own success criterion is
//   "when the OWNER turns them on for SmartGift", and ADR-090 D6 already
//   names the Business OWNER (alongside LINE_OA_PUBLISHER) as the authority
//   that approves or rejects any one candidate — the same actor deciding
//   whether the feature exists for their Business at all is the narrower
//   grant, not a wider one. LINE_OA_PUBLISHER is deliberately excluded here:
//   D6 gives that role authority over individual candidates, never over
//   whether the Business admits any at all.
//
//   `requestedBy`/`reason` are separate from the acting principal
//   (`actorId`, from `viewer`): TASK-ZAI-099 asks for "who asked", and in an
//   operator-run production script (scripts/enable-knowledge-candidates-
//   for-smartgift.mjs) the acting principal resolved from the database and
//   the person whose instruction is being carried out are not always the
//   same row. Both are recorded — `actorId` is who performed the write,
//   `requestedBy`/`reason` are who asked and why — never collapsed into one.
// @spec ADR-090 D6; BR-001; SEC-003
// @tested tests/integration/fr236-knowledge-candidates-business-toggle.test.js
import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { businessHasKnowledgeCandidatesEnabled } from '@/lib/business-knowledge-candidates'
import { recordAudit } from '@/modules/project-manager/application/audit'

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function notFound(message) {
  const error = new Error(message)
  error.status = 404
  return error
}

function conflict(message) {
  const error = new Error(message)
  error.status = 409
  return error
}

// Same idiom as business-capability-service.js and
// business-strategy-mutation-service.js: role === 'OWNER' is a global
// per-principal label, so it is paired with ownsBusiness(viewer, id) — the
// actual per-Business grant — never used alone.
function requireOwner(viewer) {
  if (viewer?.role !== 'OWNER') throw badRequest('OWNER role required')
}

export const zKnowledgeCandidatesToggle = z.object({
  version: z.number().int().positive(),
  enabled: z.boolean(),
  // Who asked for this change — the owner's own name/identifier, not
  // necessarily the acting principal. Required: TASK-ZAI-099's success
  // criterion is explicitly "recorded with its date and who asked", and an
  // audit row with only an actorId cannot answer that for an operator-run
  // script whose acting principal is a service identity.
  requestedBy: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict()

function serialize(business) {
  return {
    id: business.id,
    version: business.version,
    knowledgeCandidatesEnabled: businessHasKnowledgeCandidatesEnabled(business),
  }
}

/**
 * Turn LINE FAQ knowledge candidate drafting on or off for a Business, under
 * expected-version compare-and-set (the same CAS shape every writer of a
 * versioned row in this codebase uses, so a concurrent unrelated Business
 * update collides on `version` rather than being silently overwritten).
 */
export async function setKnowledgeCandidatesEnabled(businessId, input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zKnowledgeCandidatesToggle.parse(input)

  const existing = await db.business.findUnique({ where: { id: businessId } })
  if (!existing) throw notFound('Business not found')
  if (!ownsBusiness(viewer, businessId)) throw badRequest('Business access denied (not owned)')
  if (existing.version !== data.version) throw conflict('Business has changed since you loaded it')

  const before = businessHasKnowledgeCandidatesEnabled(existing)
  if (before === data.enabled) {
    // No-op patch: nothing to bump or audit (same rule as
    // updateBusinessCapability's and updateGoal's empty patch).
    return serialize(existing)
  }

  const updated = await db.$transaction(async (tx) => {
    const business = await tx.business.update({
      where: { id: businessId },
      data: { knowledgeCandidatesEnabled: data.enabled, version: { increment: 1 } },
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS',
      entityId: businessId,
      action: 'KNOWLEDGE_CANDIDATES_ENABLED_CHANGED',
      payload: { from: before, to: data.enabled, requestedBy: data.requestedBy, reason: data.reason ?? null },
      actorId: viewer?.principal?.id ?? null,
      businessId,
    })
    return business
  })

  return serialize(updated)
}
