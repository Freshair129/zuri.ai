import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { zErasePrincipalInput } from '@/lib/validation/entities'

// @req FR-022, FR-095 — PDPA erasure for a principal (the erase-revoke leg of the P3 gate).
// @spec docs/replacement/IMPACT-SCAN-IDENTITY.md §hazard-5 — ExternalIdentity is a
//   third handle copy of the person; erasing a customer that only nulls the legacy
//   columns leaves them re-contactable through the mapping table. So erase MUST
//   revoke the ExternalIdentity, and a revoked binding refuses to resolve (FR-021),
//   which is what makes an erased person un-reachable rather than merely hidden.
// @spec ADR-045 D2, SEC-003 — append-only audit; erase is recorded, never a silent purge.
// @spec .brain/rca/2026-08-31-conversation-analysis-tenant-binding.md
// @tested tests/integration/identity-erase.test.js, tests/integration/crm-conversation-analysis.test.js

const REDACTED = '[erased]'

/**
 * Erase a principal within a tenant: revoke every channel identity, invalidate any
 * outstanding link tokens (so a dangling token can't re-attach the person), and
 * soft-delete + redact the tenant's CRM record. Tenant-scoped by design — the
 * global Person is redacted only when it has no ties left anywhere.
 *
 * @returns {{ revokedIdentities, revokedChannelIdentities, erasedCustomers, erasedAnalyses, invalidatedTokens, revokedSessions, personRedacted }}
 */
export async function erasePrincipal(input) {
  const { tenantId, personId, reason } = zErasePrincipalInput.parse(input)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const revoked = await tx.externalIdentity.updateMany({
      where: { tenantId, personId, revokedAt: null },
      data: { revokedAt: now },
    })
    const tokens = await tx.identityLinkToken.updateMany({
      where: { tenantId, personId, consumedAt: null },
      data: { consumedAt: now },
    })
    const sessions = await tx.session.updateMany({
      where: { personId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        revokeReason: 'PERSON_ERASED',
        version: { increment: 1 },
      },
    })
    const channelIdentities = await tx.channelIdentity.updateMany({
      where: { tenantId, personId, status: { not: 'REVOKED' } },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        version: { increment: 1 },
      },
    })
    const customers = await tx.customer.findMany({ where: { tenantId, personId }, select: { id: true, deletedAt: true } })
    const customerIds = customers.map((customer) => customer.id)
    const activeCustomers = customers.filter((customer) => customer.deletedAt === null)
    const conversations = customerIds.length
      ? await tx.conversation.findMany({ where: { tenantId, customerId: { in: customerIds } }, select: { id: true } })
      : []
    const analyses = conversations.length
      ? await tx.conversationAnalysis.deleteMany({
        where: { conversationId: { in: conversations.map((conversation) => conversation.id) } },
      })
      : { count: 0 }
    for (const c of activeCustomers) {
      await tx.customer.update({
        where: { id: c.id },
        data: { deletedAt: now, displayName: REDACTED, lifecycleStage: 'LOST' },
      })
    }

    // Redact the global Person only when erasing it here leaves nothing behind:
    // no membership anywhere and no other live customer in another tenant.
    const [otherMemberships, otherCustomers] = await Promise.all([
      tx.membership.count({ where: { personId } }),
      tx.customer.count({ where: { personId, deletedAt: null, tenantId: { not: tenantId } } }),
    ])
    let personRedacted = false
    if (otherMemberships === 0 && otherCustomers === 0) {
      await tx.person.update({ where: { id: personId }, data: { displayName: REDACTED, email: null } })
      personRedacted = true
    }

    await recordAudit(tx, {
      entityType: 'PRINCIPAL',
      entityId: personId,
      action: 'ERASED',
      actorType: 'LOCAL_USER',
      payload: {
        tenantId,
        reason: reason || null,
        revokedIdentities: revoked.count,
        revokedChannelIdentities: channelIdentities.count,
        invalidatedTokens: tokens.count,
        revokedSessions: sessions.count,
        erasedCustomers: activeCustomers.length,
        erasedAnalyses: analyses.count,
        personRedacted,
      },
    })

    return {
      revokedIdentities: revoked.count,
      revokedChannelIdentities: channelIdentities.count,
      invalidatedTokens: tokens.count,
      revokedSessions: sessions.count,
      erasedCustomers: activeCustomers.length,
      erasedAnalyses: analyses.count,
      personRedacted,
    }
  })
}
