import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { zBudgetSignal } from '@/lib/validation/enums'

// @req FR-126 — the AI-inferred Customer Profile: a 1:0..1 advisory row on Customer.
// @spec BR-002, SEC-005, SEC-009 — ADR-054 D2/D3/D4/D6
// @tested tests/integration/crm-conversation-intelligence.test.js, tests/unit/conversation-intelligence.test.js
//
// Derived data, never identity: Person/ChannelIdentity remain the only identity
// truth (FR-094), and nothing here merges channels — the legacy phone-number merge
// is the pattern ADR-054 D4 refuses. The row must always be regenerable from
// retained conversations, so every write replaces the inferred attributes whole;
// `inferenceCount`/`lastInferredAt` are provenance, the one thing that accumulates.
//
// Scope: a tenantId the caller resolved server-side, same trust shape as the other
// crm producer-side writers. The customer resolves within that tenant in one query.

export const zCustomerProfileInference = z.object({
  demographicBand: z.string().min(1).max(200).optional(),
  occupation: z.string().min(1).max(200).optional(),
  motivations: z.array(z.string().min(1).max(100)).max(20).default([]),
  budgetSignal: zBudgetSignal.optional(),
}).strict()

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * Record one profile inference run: upsert the 1:1 row, replacing inferred
 * attributes whole and accumulating provenance.
 *
 * @param {{tenantId: string, customerId: string, profile: object, correlationId?: string}} input
 * @returns {Promise<{profileId: string, customerId: string, inferenceCount: number}>}
 */
export async function recordCustomerProfileInference({ tenantId, customerId, profile, correlationId }) {
  if (!tenantId) throw failure(400, 'TENANT_REQUIRED')
  const data = zCustomerProfileInference.parse(profile)

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!customer) throw failure(404, 'CUSTOMER_NOT_FOUND')

  const attributes = {
    demographicBand: data.demographicBand ?? null,
    occupation: data.occupation ?? null,
    motivationsJson: JSON.stringify(data.motivations),
    budgetSignal: data.budgetSignal ?? null,
    lastInferredAt: new Date(),
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.customerProfile.upsert({
      where: { customerId: customer.id },
      create: { customerId: customer.id, ...attributes, inferenceCount: 1 },
      update: { ...attributes, inferenceCount: { increment: 1 } },
    })

    await recordAudit(tx, {
      entityType: 'CUSTOMER',
      entityId: customer.id,
      action: 'PROFILE_INFERRED',
      actorType: 'AGENT',
      // Provenance only — the inferred attributes are personal data (SEC-005)
      // and live on the row, not in the audit payload (SEC-009).
      payload: {
        tenantId,
        customerId: customer.id,
        profileId: row.id,
        inferenceCount: row.inferenceCount,
        ...(correlationId ? { correlationId } : {}),
      },
    })

    return { profileId: row.id, customerId: customer.id, inferenceCount: row.inferenceCount }
  })
}
