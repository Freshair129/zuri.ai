import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { zResolveLineIdentityInput } from '@/lib/validation/entities'
import {
  channelIdentityIsVerified,
  findChannelIdentity,
  revokeChannelIdentity,
  syncChannelIdentityFromExternal,
} from './channel-identity'

// @req FR-021 — LINE ↔ Person identity resolution (the P3 foundation primitive).
// @spec ADR-007 §P3 — memory/authorisation are keyed by principal, not channel;
//   this resolver is the single place a lineUserId becomes a Person, so every
//   surface routes through it before any of them flips (docs/replacement/IMPACT-SCAN-IDENTITY.md).
// @spec BR-001, SEC-001 — tenant is the isolation boundary; resolution is always
//   explicitly tenant-scoped (V2 has no ambient tenant context).
// @req FR-097 — the additive ChannelIdentity lifecycle is synchronized here;
//   transport discovery remains pending until a server-owned link confirms it.
// @spec ADR-044, ADR-045 D1/D5-D6, BR-020, SEC-018
// @tested tests/integration/identity-resolve.test.js

const PROVIDER = 'LINE'

const personCodeExists = async (code) => Boolean(await prisma.person.findUnique({ where: { code } }))

const whereKey = (tenantId, lineUserId) => ({
  tenantId_provider_providerSubject: { tenantId, provider: PROVIDER, providerSubject: lineUserId },
})

/**
 * Resolve a LINE user to a Person principal, within a tenant.
 * Guarantees: never mints identity without a resolved tenant; idempotent on
 * (tenant, provider, lineUserId); first contact creates Person + mapping in one
 * transaction and audits it; a revoked mapping refuses to resolve until re-linked.
 *
 * @returns {{ personId: string, externalIdentityId: string, created: boolean }}
 */
export async function resolveLineIdentity(input) {
  const { tenantId, lineUserId, channelAccountId, displayName } = zResolveLineIdentityInput.parse(input)

  // Guard: a positively-resolved tenant is required — never mint identity under an
  // unresolved/DEFAULT tenant (the parity scan's DEFAULT_TENANT_ID hazard).
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant) {
    throw new Error('resolveLineIdentity requires an existing tenant; refusing to mint identity under an unresolved tenant')
  }

  // The additive channel row is the forward lookup contract. ExternalIdentity is
  // consulted only to prove compatibility with the legacy resolver and to expose
  // its historical verification timestamps.
  const channelRecord = await findChannelIdentity({ tenantId, providerSubject: lineUserId, channelAccountId })
  if (channelRecord) {
    if (channelRecord.status === 'REVOKED') {
      throw new Error('This LINE identity was revoked; re-linking is required before it can resolve again')
    }
    const legacy = await prisma.externalIdentity.findUnique({ where: whereKey(tenantId, lineUserId) })
    if (!legacy || legacy.personId !== channelRecord.personId) {
      throw new Error('CHANNEL_IDENTITY_COMPATIBILITY_CONFLICT')
    }
    if (legacy.revokedAt) {
      throw new Error('This LINE identity was revoked; re-linking is required before it can resolve again')
    }
    const channelIdentity = await syncChannelIdentityFromExternal({
      tenantId,
      personId: legacy.personId,
      channelAccountId,
      providerSubject: lineUserId,
      verifiedAt: legacy.verifiedAt,
      linkedAt: legacy.linkedAt,
    })
    return {
      personId: legacy.personId,
      externalIdentityId: legacy.id,
      created: false,
      verifiedAt: legacy.verifiedAt,
      linkedAt: legacy.linkedAt,
      channelIdentity,
      identityVerified: channelIdentityIsVerified(channelIdentity),
    }
  }

  const existing = await prisma.externalIdentity.findUnique({ where: whereKey(tenantId, lineUserId) })
  if (existing) {
    if (existing.revokedAt) {
      throw new Error('This LINE identity was revoked; re-linking is required before it can resolve again')
    }
    const channelIdentity = await syncChannelIdentityFromExternal({
      tenantId,
      personId: existing.personId,
      channelAccountId,
      providerSubject: lineUserId,
      verifiedAt: existing.verifiedAt,
      linkedAt: existing.linkedAt,
    })
    return {
      personId: existing.personId,
      externalIdentityId: existing.id,
      created: false,
      verifiedAt: existing.verifiedAt,
      linkedAt: existing.linkedAt,
      channelIdentity,
      identityVerified: channelIdentityIsVerified(channelIdentity),
    }
  }

  // First contact: create Person + ExternalIdentity atomically. The @@unique on
  // (tenantId, provider, providerSubject) makes concurrent first-contacts safe —
  // the loser gets P2002 and reads the winner's row.
  const code = await uniqueHumanCode('PSN', displayName || lineUserId, personCodeExists)
  try {
    const now = new Date()
    const result = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({ data: { code, displayName: displayName || 'LINE user' } })
      const identity = await tx.externalIdentity.create({
        // First contact discovers a channel subject; it does not prove ownership.
        // Account linking or an approved admin flow sets verifiedAt/linkedAt later.
        data: { tenantId, personId: person.id, provider: PROVIDER, providerSubject: lineUserId },
      })
      const channelIdentity = await syncChannelIdentityFromExternal({
        db: tx,
        tenantId,
        personId: person.id,
        channelAccountId,
        providerSubject: lineUserId,
      })
      await recordAudit(tx, {
        entityType: 'EXTERNAL_IDENTITY',
        entityId: identity.id,
        action: 'LINKED',
        actorType: 'LINE',
        payload: { tenantId, provider: PROVIDER, personId: person.id, verificationStatus: 'PENDING' },
      })
      return { person, identity, channelIdentity }
    })
    return {
      personId: result.person.id,
      externalIdentityId: result.identity.id,
      created: true,
      verifiedAt: null,
      linkedAt: null,
      channelIdentity: result.channelIdentity,
      identityVerified: false,
    }
  } catch (err) {
    // Lost a first-contact race: the mapping now exists — return the winner's.
    if (err?.code === 'P2002') {
      const row = await prisma.externalIdentity.findUnique({ where: whereKey(tenantId, lineUserId) })
      if (row && !row.revokedAt) {
        const channelIdentity = await syncChannelIdentityFromExternal({
          tenantId,
          personId: row.personId,
          channelAccountId,
          providerSubject: lineUserId,
          verifiedAt: row.verifiedAt,
          linkedAt: row.linkedAt,
        })
        return {
          personId: row.personId,
          externalIdentityId: row.id,
          created: false,
          verifiedAt: row.verifiedAt,
          linkedAt: row.linkedAt,
          channelIdentity,
          identityVerified: channelIdentityIsVerified(channelIdentity),
        }
      }
    }
    throw err
  }
}

/**
 * Revoke a LINE identity binding. A revoked binding stops resolving (the erasure /
 * unlink path) until a fresh link is made. Audited.
 */
export async function revokeLineIdentity(tenantId, lineUserId, { channelAccountId } = {}) {
  const existing = await prisma.externalIdentity.findUnique({ where: whereKey(tenantId, lineUserId) })
  if (!existing) throw new Error('No such LINE identity to revoke')
  const updated = await prisma.externalIdentity.update({ where: { id: existing.id }, data: { revokedAt: new Date() } })
  await recordAudit(prisma, {
    entityType: 'EXTERNAL_IDENTITY',
    entityId: existing.id,
    action: 'REVOKED',
    actorType: 'LINE',
    payload: { tenantId, provider: PROVIDER },
  })
  const channelIdentity = await revokeChannelIdentity({ tenantId, channelAccountId, providerSubject: lineUserId })
  return { ...updated, channelIdentity }
}
