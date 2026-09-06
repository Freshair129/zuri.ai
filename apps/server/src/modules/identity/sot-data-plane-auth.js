import { createHash, randomBytes } from 'node:crypto'
import prisma from '../../lib/db.js'

// @req FR-102 — a bearer credential scoped to exactly one Tenant lets the SoT
// pipeline's external data plane authenticate to the FR-100 decision
// submit/export endpoints without a browser session and without a Person
// identity. The raw secret exists only at mint time; only its SHA-256 hash is
// ever persisted — the same lookup-hash approach `hashSessionToken` already
// uses for Session, appropriate here for the same reason: the secret is
// generated high-entropy random, not a low-entropy human password, so a
// deliberately slow KDF (scrypt, used for `PersonCredential`) buys nothing.
// @spec ADR-047, SEC-019
// @tested tests/unit/sot-data-plane-auth.test.js

export const SOT_DATA_PLANE_KEY_PREFIX = 'sdpk'
const KEY_SECRET_BYTES = 24
// Long enough to identify a key in an admin listing, short enough that it is
// never useful toward reconstructing the secret.
const KEY_PREFIX_LENGTH = SOT_DATA_PLANE_KEY_PREFIX.length + 1 + 8

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex')
}

/**
 * Mint a new data-plane key. Returns the raw secret exactly once — callers
 * (the `scripts/mint-sot-data-plane-key.mjs` CLI) must hand it to the
 * connector's own secret storage immediately; it cannot be recovered from the
 * database afterward.
 */
export async function mintSotDataPlaneKey({ label, tenantId, db = prisma } = {}) {
  if (typeof label !== 'string' || !label.trim()) throw new Error('SOT_DATA_PLANE_LABEL_REQUIRED')
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new Error('SOT_DATA_PLANE_TENANT_REQUIRED')

  const rawKey = `${SOT_DATA_PLANE_KEY_PREFIX}_${randomBytes(KEY_SECRET_BYTES).toString('base64url')}`
  const row = await db.sotDataPlaneKey.create({
    data: {
      label: label.trim(),
      tenantId,
      keyHash: hashKey(rawKey),
      keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
    },
  })

  return { id: row.id, key: rawKey, label: row.label, tenantId: row.tenantId }
}

/** Revoke a key immediately. No grace period — see the module note above. */
export async function revokeSotDataPlaneKey(id, { reason = 'REVOKED', db = prisma } = {}) {
  if (typeof id !== 'string' || !id.trim()) return false
  const result = await db.sotDataPlaneKey.updateMany({
    where: { id, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason },
  })
  return result.count > 0
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
 * Resolve a request's SoT data-plane viewer from its `Authorization: Bearer`
 * header. Returns `null` — never throws — whenever the header names a
 * different identity than this one: absent, not a `sdpk_`-prefixed token, or
 * a token that does not match an active key. That is deliberate: this
 * resolver only answers "is this the data plane", and every `null` is the
 * caller's cue to fall through to `resolveRequestViewer` (session auth) next,
 * exactly as `createSessionPort`'s own `readTrustedSession` seam falls through
 * to the cookie when it returns nothing. A revoked or forged key therefore
 * ends up correctly unauthenticated via the normal session path, not through
 * a second error shape this module would have to keep consistent with it.
 */
export async function resolveSotDataPlaneViewer(request, { db = prisma } = {}) {
  const token = bearerToken(request)
  if (!token || !token.startsWith(`${SOT_DATA_PLANE_KEY_PREFIX}_`)) return null

  const row = await db.sotDataPlaneKey.findUnique({ where: { keyHash: hashKey(token) } })
  if (!row || row.status !== 'ACTIVE') return null

  await db.sotDataPlaneKey.updateMany({
    where: { id: row.id, status: 'ACTIVE' },
    data: { lastUsedAt: new Date() },
  })

  return { isSotDataPlane: true, tenantId: row.tenantId, serviceAccountId: row.id }
}
