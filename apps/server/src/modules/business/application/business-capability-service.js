// @req FR-169 — the only writer of Business.capabilitiesJson. An OWNER of the
//   target Business turns one named capability on or off; everything else
//   about the Business is untouched, and the write is one versioned,
//   audited transaction (BR-001, SEC-003) — the same shape as every other
//   Business-scoped mutation in this application layer
//   (business-strategy-mutation-service.js).
// @spec BR-001, SEC-003, ADR-069
// @tested tests/integration/fr169-business-capability.test.js
import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { BUSINESS_CAPABILITY_KEYS, businessHasCapability, parseCapabilities } from '@/lib/business-capabilities'
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

// Same idiom as business-strategy-mutation-service.js: role === 'OWNER' is a
// global per-principal label, so it is paired with ownsBusiness(viewer, id) —
// the actual per-Business grant — never used alone.
function requireOwner(viewer) {
  if (viewer?.role !== 'OWNER') throw badRequest('OWNER role required')
}

export const zCapabilityUpdate = z.object({
  version: z.number().int().positive(),
  capability: z.enum(BUSINESS_CAPABILITY_KEYS),
  enabled: z.boolean(),
}).strict()

function serialize(business) {
  const capabilities = parseCapabilities(business.capabilitiesJson)
  return {
    id: business.id,
    version: business.version,
    capabilities: Object.fromEntries(
      BUSINESS_CAPABILITY_KEYS.map((key) => [key, businessHasCapability(capabilities, key)]),
    ),
  }
}

/**
 * Turn one capability on or off for a Business, under expected-version
 * compare-and-set. `capabilitiesJson` is read-modify-written whole (never a
 * partial JSON patch at the database level), so two concurrent toggles of
 * *different* capabilities still collide on `version` rather than silently
 * clobbering each other — the same reason every CAS write in this codebase
 * updates the whole row.
 */
export async function updateBusinessCapability(businessId, input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zCapabilityUpdate.parse(input)

  const existing = await db.business.findUnique({ where: { id: businessId } })
  if (!existing) throw notFound('Business not found')
  if (!ownsBusiness(viewer, businessId)) throw badRequest('Business access denied (not owned)')
  if (existing.version !== data.version) throw conflict('Business has changed since you loaded it')

  const current = parseCapabilities(existing.capabilitiesJson)
  const before = businessHasCapability(current, data.capability)
  if (before === data.enabled) {
    // No-op patch: nothing to bump or audit (same rule as updateGoal's empty patch).
    return serialize(existing)
  }
  const next = { ...current, [data.capability]: data.enabled }

  const updated = await db.$transaction(async (tx) => {
    const business = await tx.business.update({
      where: { id: businessId },
      data: { capabilitiesJson: JSON.stringify(next), version: { increment: 1 } },
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS',
      entityId: businessId,
      action: 'CAPABILITY_CHANGED',
      payload: { capability: data.capability, from: before, to: data.enabled },
      actorId: viewer?.id ?? null,
    })
    return business
  })

  return serialize(updated)
}
