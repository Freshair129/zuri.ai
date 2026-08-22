import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-097 — channel subjects have a server-owned pending/active/revoked lifecycle.
// @spec ADR-044, ADR-045 D1/D5-D6, BR-020, SEC-018 — channel transport is not
//   Person authority; the trusted channel account namespace is part of the lookup key.
// @tested tests/integration/channel-identity.test.js

export const CHANNEL = 'LINE'
export const LEGACY_CHANNEL_ACCOUNT_ID = 'LEGACY:LINE'
export const CHANNEL_IDENTITY_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
})

const keyFor = (tenantId, channel, channelAccountId, providerSubject) => ({
  tenantId_channel_channelAccountId_providerSubject: { tenantId, channel, channelAccountId, providerSubject },
})

function conflict(message) {
  throw new Error(message)
}

function accountId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : LEGACY_CHANNEL_ACCOUNT_ID
}

function publicRow(row) {
  if (!row) return null
  return Object.freeze({
    id: row.id,
    personId: row.personId,
    tenantId: row.tenantId,
    channel: row.channel,
    channelAccountId: row.channelAccountId,
    status: row.status,
    verifiedAt: row.verifiedAt,
    linkedAt: row.linkedAt,
    revokedAt: row.revokedAt,
  })
}

export function channelIdentityIsVerified(row) {
  return Boolean(
    row &&
      row.status === CHANNEL_IDENTITY_STATUS.ACTIVE &&
      row.verifiedAt &&
      row.linkedAt &&
      !row.revokedAt,
  )
}

export async function findChannelIdentity({
  db = prisma,
  tenantId,
  channel = CHANNEL,
  channelAccountId,
  providerSubject,
} = {}) {
  const row = await db.channelIdentity.findUnique({
    where: keyFor(tenantId, channel, accountId(channelAccountId), providerSubject),
  })
  if (row && row.tenantId !== tenantId) conflict('CHANNEL_IDENTITY_NAMESPACE_CONFLICT')
  return row
}

/**
 * Ensure a discovered channel subject has a row without granting it authority.
 * Existing rows are never re-homed by transport input.
 */
export async function ensureChannelIdentity({
  db = prisma,
  tenantId,
  personId,
  channel = CHANNEL,
  channelAccountId,
  providerSubject,
  status = CHANNEL_IDENTITY_STATUS.PENDING,
  verifiedAt = null,
  linkedAt = null,
  audit = true,
} = {}) {
  const namespace = accountId(channelAccountId)
  const where = keyFor(tenantId, channel, namespace, providerSubject)
  const existing = await db.channelIdentity.findUnique({ where })
  if (existing) {
    if (existing.tenantId !== tenantId) conflict('CHANNEL_IDENTITY_NAMESPACE_CONFLICT')
    if (existing.personId !== personId) conflict('CHANNEL_IDENTITY_PERSON_CONFLICT')
    return { row: existing, created: false }
  }

  try {
    const row = await db.channelIdentity.create({
      data: {
        tenantId,
        personId,
        channel,
        channelAccountId: namespace,
        providerSubject,
        status,
        verifiedAt,
        linkedAt,
      },
    })
    if (audit) {
      await recordAudit(db, {
        entityType: 'CHANNEL_IDENTITY',
        entityId: row.id,
        action: 'DISCOVERED',
        actorType: 'LINE',
        payload: { tenantId, channel, channelAccountId: namespace, personId, status },
      })
    }
    return { row, created: true }
  } catch (error) {
    if (error?.code !== 'P2002') throw error
    const winner = await db.channelIdentity.findUnique({ where })
    if (!winner) throw error
    if (winner.tenantId !== tenantId) conflict('CHANNEL_IDENTITY_NAMESPACE_CONFLICT')
    if (winner.personId !== personId) conflict('CHANNEL_IDENTITY_PERSON_CONFLICT')
    return { row: winner, created: false }
  }
}

/**
 * Mirror the legacy ExternalIdentity state into the additive ChannelIdentity
 * namespace. A revoked ChannelIdentity remains revoked; transport cannot revive it.
 */
export async function syncChannelIdentityFromExternal({
  db = prisma,
  tenantId,
  personId,
  channel = CHANNEL,
  channelAccountId,
  providerSubject,
  verifiedAt = null,
  linkedAt = null,
} = {}) {
  const current = await findChannelIdentity({ db, tenantId, channel, channelAccountId, providerSubject })
  if (current?.status === CHANNEL_IDENTITY_STATUS.REVOKED) return publicRow(current)

  const verified = Boolean(verifiedAt && linkedAt)
  const ensured = await ensureChannelIdentity({
    db,
    tenantId,
    personId,
    channel,
    channelAccountId,
    providerSubject,
    status: verified ? CHANNEL_IDENTITY_STATUS.ACTIVE : CHANNEL_IDENTITY_STATUS.PENDING,
    verifiedAt,
    linkedAt,
  })
  if (!verified || ensured.row.status === CHANNEL_IDENTITY_STATUS.ACTIVE) return publicRow(ensured.row)

  const row = await db.channelIdentity.update({
    where: { id: ensured.row.id },
    data: {
      status: CHANNEL_IDENTITY_STATUS.ACTIVE,
      verifiedAt,
      linkedAt,
      revokedAt: null,
      version: { increment: 1 },
    },
  })
  return publicRow(row)
}

/** Confirm a channel through the existing server-owned link-token flow. */
export async function activateChannelIdentity({
  db = prisma,
  tenantId,
  personId,
  channel = CHANNEL,
  channelAccountId,
  providerSubject,
  now = new Date(),
  allowReassign = false,
} = {}) {
  const namespace = accountId(channelAccountId)
  const where = keyFor(tenantId, channel, namespace, providerSubject)
  const existing = await db.channelIdentity.findUnique({ where })
  if (existing && existing.tenantId !== tenantId) conflict('CHANNEL_IDENTITY_NAMESPACE_CONFLICT')
  if (existing && existing.personId !== personId && !allowReassign) conflict('CHANNEL_IDENTITY_PERSON_CONFLICT')

  const row = existing
    ? await db.channelIdentity.update({
        where: { id: existing.id },
        data: {
          personId,
          status: CHANNEL_IDENTITY_STATUS.ACTIVE,
          verifiedAt: now,
          linkedAt: now,
          revokedAt: null,
          version: { increment: 1 },
        },
      })
    : await db.channelIdentity.create({
        data: {
          tenantId,
          personId,
          channel,
          channelAccountId: namespace,
          providerSubject,
          status: CHANNEL_IDENTITY_STATUS.ACTIVE,
          verifiedAt: now,
          linkedAt: now,
        },
      })

  await recordAudit(db, {
    entityType: 'CHANNEL_IDENTITY',
    entityId: row.id,
    action: 'LINK_CONFIRMED',
    actorType: 'LOCAL_USER',
    payload: { tenantId, channel, channelAccountId: namespace, personId, status: row.status },
  })
  return publicRow(row)
}

export async function revokeChannelIdentity({
  db = prisma,
  tenantId,
  channel = CHANNEL,
  channelAccountId,
  providerSubject,
  now = new Date(),
} = {}) {
  const existing = await findChannelIdentity({ db, tenantId, channel, channelAccountId, providerSubject })
  if (!existing || existing.status === CHANNEL_IDENTITY_STATUS.REVOKED) return publicRow(existing)

  const row = await db.channelIdentity.update({
    where: { id: existing.id },
    data: {
      status: CHANNEL_IDENTITY_STATUS.REVOKED,
      revokedAt: now,
      version: { increment: 1 },
    },
  })
  await recordAudit(db, {
    entityType: 'CHANNEL_IDENTITY',
    entityId: row.id,
    action: 'REVOKED',
    actorType: 'LOCAL_USER',
    payload: { tenantId, channel, channelAccountId: row.channelAccountId, personId: row.personId, status: row.status },
  })
  return publicRow(row)
}

export { publicRow }
