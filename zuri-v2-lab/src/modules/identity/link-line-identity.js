import { randomBytes } from 'node:crypto'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { zIssueLinkTokenInput, zRedeemLinkTokenInput } from '@/lib/validation/entities'

// @req FR-022 — account linking: bind a LINE subject to an EXISTING Person instead
//   of minting a fresh one (the resolveLineIdentity first-contact default).
// @spec ADR-007 §P3, docs/replacement/IMPACT-SCAN-IDENTITY.md §3 — one shared
//   resolution point; linking must not fork the principal. A subject already
//   auto-minted to a throwaway Person is re-pointed to the canonical one (a merge),
//   never left as a second principal for the same human.
// @spec BR-002 — providerSubject is an attribute, never a PK; the binding lives on
//   ExternalIdentity keyed by (tenantId, provider, providerSubject).
// @tested tests/integration/identity-link.test.js

const PROVIDER = 'LINE'

const whereKey = (tenantId, lineUserId) => ({
  tenantId_provider_providerSubject: { tenantId, provider: PROVIDER, providerSubject: lineUserId },
})

/**
 * Issue a single-use, expiring token for an existing Person, to be presented by a
 * LINE user (via deep link / LIFF) to prove they are that principal.
 * @returns {{ token: string, tokenId: string, expiresAt: Date }}
 */
export async function issueLinkToken(input) {
  const { tenantId, personId, ttlSeconds } = zIssueLinkTokenInput.parse(input)

  const [tenant, person] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.person.findUnique({ where: { id: personId } }),
  ])
  if (!tenant) throw new Error('issueLinkToken requires an existing tenant')
  if (!person) throw new Error('issueLinkToken requires an existing person to link to')

  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  const row = await prisma.identityLinkToken.create({
    data: { tenantId, personId, provider: PROVIDER, token, expiresAt },
  })
  await recordAudit(prisma, {
    entityType: 'IDENTITY_LINK_TOKEN',
    entityId: row.id,
    action: 'ISSUED',
    payload: { tenantId, personId, provider: PROVIDER, expiresAt: expiresAt.toISOString() },
  })
  return { token, tokenId: row.id, expiresAt }
}

/**
 * Redeem a link token against a LINE subject, binding the subject to the token's
 * Person. Idempotent when already bound to that Person; reactivates a revoked
 * binding; and — only with { merge: true } — re-points a binding that currently
 * resolves to a different (e.g. auto-minted) principal, carrying its Customer along
 * so conversation history follows the canonical person and never forks.
 *
 * @returns {{ personId, externalIdentityId, linked, reactivated, merged, fromPersonId }}
 */
export async function redeemLinkToken(input) {
  const { tenantId, token, lineUserId, displayName, merge } = zRedeemLinkTokenInput.parse(input)

  const tok = await prisma.identityLinkToken.findUnique({ where: { token } })
  if (!tok || tok.tenantId !== tenantId) throw new Error('Invalid link token')
  if (tok.consumedAt) throw new Error('This link token has already been used')
  if (tok.expiresAt.getTime() <= Date.now()) throw new Error('This link token has expired')

  const targetPersonId = tok.personId
  const existing = await prisma.externalIdentity.findUnique({ where: whereKey(tenantId, lineUserId) })

  // Reject a genuine merge unless the caller opted in — silently re-homing a
  // subject that already resolves to another principal is exactly the fork the
  // impact scan warns against.
  if (existing && existing.personId !== targetPersonId && !existing.revokedAt && !merge) {
    throw new Error('This LINE identity is already linked to a different principal; pass merge:true to re-point it')
  }

  const now = new Date()
  const result = await prisma.$transaction(async (tx) => {
    let identity
    let linked = false
    let reactivated = false
    let merged = false
    let fromPersonId = null

    if (!existing) {
      identity = await tx.externalIdentity.create({
        data: { tenantId, personId: targetPersonId, provider: PROVIDER, providerSubject: lineUserId, verifiedAt: now, linkedAt: now },
      })
      linked = true
    } else if (existing.personId === targetPersonId) {
      // Same principal: idempotent, but reactivate if it had been revoked.
      if (existing.revokedAt) {
        identity = await tx.externalIdentity.update({
          where: { id: existing.id },
          data: { revokedAt: null, linkedAt: now, verifiedAt: now },
        })
        reactivated = true
      } else {
        identity = existing
      }
    } else {
      // Different principal + merge opted-in: re-point the mapping to the canonical
      // person and bring its Customer across when the target has none (avoiding the
      // Customer @@unique([tenantId, personId]) collision).
      fromPersonId = existing.personId
      identity = await tx.externalIdentity.update({
        where: { id: existing.id },
        data: { personId: targetPersonId, revokedAt: null, linkedAt: now, verifiedAt: now },
      })
      merged = true

      const [orphanCustomer, targetCustomer] = await Promise.all([
        tx.customer.findFirst({ where: { tenantId, personId: fromPersonId, deletedAt: null } }),
        tx.customer.findFirst({ where: { tenantId, personId: targetPersonId, deletedAt: null } }),
      ])
      if (orphanCustomer && !targetCustomer) {
        await tx.customer.update({ where: { id: orphanCustomer.id }, data: { personId: targetPersonId } })
        await recordAudit(tx, {
          entityType: 'CUSTOMER',
          entityId: orphanCustomer.id,
          action: 'REPOINTED',
          actorType: 'LINE',
          payload: { tenantId, fromPersonId, toPersonId: targetPersonId },
        })
      } else if (orphanCustomer && targetCustomer) {
        // Both principals have a CRM record — a true merge that needs CRM's
        // preview/confirm path (BR-009); flag it, do not silently collide.
        await recordAudit(tx, {
          entityType: 'CUSTOMER',
          entityId: targetCustomer.id,
          action: 'MERGE_PENDING',
          actorType: 'LINE',
          payload: { tenantId, fromCustomerId: orphanCustomer.id, fromPersonId, toPersonId: targetPersonId },
        })
      }
    }

    // Optionally refresh the person's display name from the freshly-verified LINE profile.
    if (displayName) {
      await tx.person.update({ where: { id: targetPersonId }, data: { displayName } })
    }

    await tx.identityLinkToken.update({ where: { id: tok.id }, data: { consumedAt: now } })
    await recordAudit(tx, {
      entityType: 'EXTERNAL_IDENTITY',
      entityId: identity.id,
      action: merged ? 'MERGED' : reactivated ? 'RELINKED' : linked ? 'LINKED' : 'LINK_CONFIRMED',
      actorType: 'LINE',
      payload: { tenantId, provider: PROVIDER, personId: targetPersonId, tokenId: tok.id, ...(fromPersonId ? { fromPersonId } : {}) },
    })

    return { identityId: identity.id, linked, reactivated, merged, fromPersonId }
  })

  return {
    personId: targetPersonId,
    externalIdentityId: result.identityId,
    linked: result.linked,
    reactivated: result.reactivated,
    merged: result.merged,
    fromPersonId: result.fromPersonId,
  }
}
