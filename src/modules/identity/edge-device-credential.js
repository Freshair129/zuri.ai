import { createHash, randomBytes } from 'node:crypto'
import prisma from '../../lib/db.js'
import { isInstallationOperator, ownsBusiness } from './viewer-authority.js'
import { recordAudit } from '../project-manager/application/audit.js'

// @req FR-144 — the credential a Zuri Edge Device presents to claim extraction
// work (FR-143) and to report liveness (FR-141). It is deliberately the FR-106
// `ApiAccessKey` mechanism narrowed by one axis rather than a new one: same
// high-entropy random secret, same SHA-256 lookup hash (never the raw value,
// never scrypt — scrypt is for low-entropy human passwords), same display
// prefix, same mint-once discipline. The axis that changes is scope: an
// ApiAccessKey is bound to a Tenant because the Enterprise API answers for a
// Tenant, while a device sits at exactly one customer premise (ADR-041), so
// this credential is bound to one Business. A stolen device key therefore
// reaches one Business's evidence queue and nothing else.
//
// What it is NOT: it is not a viewer. It never satisfies `ownsBusiness`,
// `seesBusiness`, `isInstallationOperator` or `isApiAccessFor`, and it carries
// no Person. Every route that accepts it takes the Business from the credential
// and refuses anything the caller names that disagrees (AC-144.8).
// @spec SEC-025, ADR-059 D2, ADR-041 D3, BR-002
// @tested tests/unit/edge-device-credential.test.js, tests/integration/fr144-edge-device-credential.test.js

export const EDGE_DEVICE_KEY_PREFIX = 'edgk'
const KEY_SECRET_BYTES = 24
// Long enough to identify a credential in the Edge tab, short enough to be
// useless toward reconstructing the secret — the same trade FR-102/FR-106 made.
const KEY_PREFIX_LENGTH = EDGE_DEVICE_KEY_PREFIX.length + 1 + 8
export const EDGE_DEVICE_CREDENTIAL_ENTITY = 'EDGE_DEVICE_CREDENTIAL'

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex')
}

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/** Not found and not yours answer identically, so the surface is no oracle (FR-072(a)). */
function notFound() {
  return failure(404, 'Business not found')
}

/**
 * May this viewer govern device credentials for this Business?
 *
 * A Business OWNER, or the installation operator. Per-Business ownership is the
 * right level here precisely because the credential is per-Business: the person
 * who answers for the premise is the person who may pair a device to it.
 */
function mayGovern(viewer, businessId) {
  return isInstallationOperator(viewer) || ownsBusiness(viewer, businessId)
}

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * Mint a credential for one device in one Business. The raw key is returned
 * exactly once, in this result — never persisted, never logged, never audited,
 * unrecoverable afterward, only reissued (AC-144.1).
 */
export async function mintEdgeDeviceCredential({ businessId, deviceId, label, viewer, db = prisma } = {}) {
  const business = trimmed(businessId)
  const device = trimmed(deviceId)
  const name = trimmed(label)
  if (!business) throw failure(400, 'EDGE_DEVICE_BUSINESS_REQUIRED')
  if (!device) throw failure(400, 'EDGE_DEVICE_ID_REQUIRED')
  if (!name) throw failure(400, 'EDGE_DEVICE_LABEL_REQUIRED')
  // Authority before existence: an unauthorized caller learns nothing about
  // which Business ids exist (SEC-001, AC-144.2).
  if (!mayGovern(viewer, business)) throw notFound()

  const row = await db.business.findUnique({ where: { id: business }, select: { id: true, tenantId: true } })
  if (!row) throw notFound()

  const rawKey = `${EDGE_DEVICE_KEY_PREFIX}_${randomBytes(KEY_SECRET_BYTES).toString('base64url')}`
  const created = await db.edgeDeviceCredential.create({
    data: {
      tenantId: row.tenantId,
      businessId: row.id,
      deviceId: device,
      label: name,
      keyHash: hashKey(rawKey),
      keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
    },
    select: {
      id: true, deviceId: true, label: true, businessId: true, keyPrefix: true,
      status: true, createdAt: true, lastUsedAt: true, revokedAt: true,
    },
  })
  await recordAudit(db, {
    entityType: EDGE_DEVICE_CREDENTIAL_ENTITY,
    entityId: created.id,
    action: 'EDGE_DEVICE_CREDENTIAL_MINTED',
    // No key material in any form — not even the display prefix. The stream
    // answers "who paired which device to which Business, when" (AC-144.6).
    payload: { businessId: created.businessId, deviceId: created.deviceId, label: created.label },
    actorId: viewer?.principal?.id ?? null,
  })
  return { credential: created, key: rawKey }
}

/**
 * The credentials of one Business, as metadata only. `keyHash` is never
 * selected and no returned field could rebuild the secret; the raw key exists
 * exactly once, in the mint response.
 */
export async function listEdgeDeviceCredentials({ businessId, viewer, db = prisma } = {}) {
  const business = trimmed(businessId)
  if (!business) throw failure(400, 'EDGE_DEVICE_BUSINESS_REQUIRED')
  if (!mayGovern(viewer, business)) throw notFound()

  const credentials = await db.edgeDeviceCredential.findMany({
    where: { businessId: business },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, deviceId: true, label: true, businessId: true, keyPrefix: true,
      status: true, createdAt: true, lastUsedAt: true, revokedAt: true, revokeReason: true,
    },
  })
  return { businessId: business, credentials }
}

/**
 * Revoke a credential. Takes effect on the very next device request — there is
 * no grace period and no session to expire, which is the whole point: nobody is
 * watching a device to notice a compromise (AC-144.5).
 */
export async function revokeEdgeDeviceCredential(id, { reason = 'REVOKED', viewer, db = prisma } = {}) {
  const credentialId = trimmed(id)
  if (!credentialId) throw notFound()
  const row = await db.edgeDeviceCredential.findUnique({
    where: { id: credentialId },
    select: { id: true, businessId: true, deviceId: true, label: true, status: true },
  })
  if (!row || !mayGovern(viewer, row.businessId)) throw notFound()

  const result = await db.edgeDeviceCredential.updateMany({
    where: { id: row.id, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: trimmed(reason) || 'REVOKED', version: { increment: 1 } },
  })
  const revoked = result.count > 0
  if (revoked) {
    await recordAudit(db, {
      entityType: EDGE_DEVICE_CREDENTIAL_ENTITY,
      entityId: row.id,
      action: 'EDGE_DEVICE_CREDENTIAL_REVOKED',
      payload: { businessId: row.businessId, deviceId: row.deviceId, label: row.label, reason: trimmed(reason) || 'REVOKED' },
      actorId: viewer?.principal?.id ?? null,
    })
  }
  return { id: row.id, revoked }
}

function bearerToken(request) {
  const header = typeof request?.headers?.get === 'function'
    ? request.headers.get('authorization')
    : request?.headers?.authorization
  if (typeof header !== 'string') return null
  const match = header.match(/^Bearer\s+(\S+)$/i)
  return match ? match[1] : null
}

/**
 * Resolve a device request's context from its `Authorization: Bearer edgk_…`
 * header.
 *
 * Returns `null` — never throws — for every shape that is not an active device
 * credential: no header, a non-Bearer header, a token with another prefix, an
 * unknown key, a revoked key. One `null` for all of them is deliberate: the
 * caller turns it into one generic 401, so the endpoint cannot be used to tell
 * a revoked key from a fabricated one (AC-144.3). A successful resolution
 * touches `lastUsedAt`; a failed one writes nothing at all (AC-144.4).
 *
 * The returned object is a device context, not a viewer — it has no `principal`
 * and no owned/visible id arrays, so passing it where a viewer is expected
 * fails closed rather than granting anything.
 */
export async function resolveEdgeDeviceContext(request, { db = prisma } = {}) {
  const token = bearerToken(request)
  if (!token || !token.startsWith(`${EDGE_DEVICE_KEY_PREFIX}_`)) return null

  const row = await db.edgeDeviceCredential.findUnique({
    where: { keyHash: hashKey(token) },
    select: { id: true, deviceId: true, businessId: true, tenantId: true, status: true },
  })
  if (!row || row.status !== 'ACTIVE') return null

  await db.edgeDeviceCredential.updateMany({
    where: { id: row.id, status: 'ACTIVE' },
    data: { lastUsedAt: new Date() },
  })
  return {
    isEdgeDevice: true,
    credentialId: row.id,
    deviceId: row.deviceId,
    businessId: row.businessId,
    tenantId: row.tenantId,
  }
}

/** The one refusal every device route uses when no credential resolves. */
export function edgeDeviceUnauthorized() {
  return failure(401, 'An edge device credential is required')
}
