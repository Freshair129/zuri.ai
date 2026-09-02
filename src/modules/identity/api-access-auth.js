import { createHash, randomBytes } from 'node:crypto'
import prisma from '../../lib/db.js'
import { isInstallationOperator, ownsTenant } from './viewer-authority.js'
import { recordAudit } from '../project-manager/application/audit.js'

// @req FR-106 — a bearer credential scoped to exactly one Tenant lets an
// enterprise integrator authenticate to the FR-019 Enterprise API
// (dry-run / commit / resolve) without a browser session. This generalizes the
// FR-102 `SotDataPlaneKey` pattern (ADR-047 D3 named exactly this follow-up)
// rather than inventing a second mechanism: high-entropy random secret, stored
// only as a SHA-256 lookup hash — never the raw value, never a scrypt-slowed
// hash (scrypt is for low-entropy human passwords, per `PersonCredential`).
// Unlike FR-102's CLI-only mint, minting here is an authenticated authority
// (installation operator, or a Tenant owner for their own Tenant — FR-074(b)),
// because FR-106 names owners as minters and an owner has no shell on the
// installation host. Mint and revoke are audited; the audit stream never
// carries token material in any form.
// @spec SEC-006, SEC-001, BR-002, ADR-047
// @tested tests/unit/api-access-auth.test.js, tests/integration/enterprise-api-auth.test.js

export const API_ACCESS_KEY_PREFIX = 'apik'
const KEY_SECRET_BYTES = 24
// Long enough to identify a key in an admin listing, short enough that it is
// never useful toward reconstructing the secret. Same shape as FR-102.
const KEY_PREFIX_LENGTH = API_ACCESS_KEY_PREFIX.length + 1 + 8

function hashKey(rawKey) {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex')
}

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * May this viewer mint or revoke an Enterprise API key for this Tenant?
 * Installation operator, or an owner in that Tenant (`ownsTenant`, FR-074(b)).
 * Per-Business ownership is deliberately NOT enough: the key's scope is the
 * whole Tenant, so the minting authority must be at least Tenant-wide.
 */
function mayGovernKeys(viewer, tenantId) {
  return isInstallationOperator(viewer) || ownsTenant(viewer, tenantId)
}

/**
 * Mint a new Enterprise API access key. The raw secret is returned exactly
 * once, in this call's result — it is never persisted, never logged, never
 * audited, and cannot be recovered afterward, only reissued.
 *
 * `viewer` is REQUIRED: minting is an authenticated authority (operator or
 * Tenant owner), unlike FR-102's operator-at-the-machine CLI. The CLI form
 * (`scripts/mint-api-access-key.mjs`) passes the operator capability the
 * person at the machine already holds (the ADR-016 local premise).
 */
export async function mintApiAccessKey({ label, tenantId, viewer, db = prisma } = {}) {
  if (typeof label !== 'string' || !label.trim()) throw failure(400, 'API_ACCESS_KEY_LABEL_REQUIRED')
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw failure(400, 'API_ACCESS_KEY_TENANT_REQUIRED')
  // Authority before existence: an unauthorized caller learns nothing about
  // which Tenant ids exist (SEC-001).
  if (!mayGovernKeys(viewer, tenantId)) {
    throw failure(403, 'Minting an Enterprise API key requires the installation operator or owner authority over this Tenant')
  }
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
  if (!tenant) throw failure(404, 'TENANT_NOT_FOUND')

  const rawKey = `${API_ACCESS_KEY_PREFIX}_${randomBytes(KEY_SECRET_BYTES).toString('base64url')}`
  const row = await db.apiAccessKey.create({
    data: {
      label: label.trim(),
      tenantId,
      keyHash: hashKey(rawKey),
      keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
    },
  })
  await recordAudit(db, {
    entityType: 'ApiAccessKey',
    entityId: row.id,
    action: 'API_ACCESS_KEY_MINTED',
    // No token material here in any form — not even the display prefix. The
    // audit stream answers "who minted a key for which Tenant, when", never
    // anything about the secret.
    payload: { tenantId: row.tenantId, label: row.label },
    actorId: viewer?.principal?.id ?? null,
  })

  return { id: row.id, key: rawKey, label: row.label, tenantId: row.tenantId }
}

/**
 * The Tenants this viewer may mint or revoke keys for, and the keys that
 * already exist in them.
 *
 * Every field here is metadata about a credential — id, label, display prefix,
 * status, timestamps. `keyHash` is never selected, and there is no field from
 * which the secret could be reconstructed: `keyPrefix` is the first 8 characters
 * of a 24-byte random secret, which is what makes a key identifiable in this
 * listing without being useful toward guessing it (the same trade FR-102 made).
 * The raw key exists exactly once, in the mint response, and is unrecoverable
 * afterward — a list endpoint that could return it would silently undo that.
 *
 * Without this, `revokeApiAccessKey` was unreachable from anywhere but a saved
 * id: minting returned an id that nothing displayed again, so a key could be
 * created and never withdrawn (D2-domain-identity-22). Scoped by exactly the
 * authority that mints and revokes, so a key visible here is one this viewer
 * can act on — no row is listed that its revoke button would 404 on.
 */
export async function listApiAccessKeys({ viewer, db = prisma } = {}) {
  const operator = isInstallationOperator(viewer)
  const ownedTenantIds = Array.isArray(viewer?.ownedTenantIds) ? viewer.ownedTenantIds.filter(Boolean) : []
  // Fails closed: a viewer with neither the operator capability nor a
  // tenant-wide OWNER Membership sees an empty panel rather than falling
  // through to an unscoped query.
  if (!operator && ownedTenantIds.length === 0) return { tenants: [], keys: [] }

  const tenants = await db.tenant.findMany({
    where: operator ? {} : { id: { in: ownedTenantIds } },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
  })
  const tenantIds = tenants.map((tenant) => tenant.id)
  if (tenantIds.length === 0) return { tenants: [], keys: [] }

  const rows = await db.apiAccessKey.findMany({
    where: { tenantId: { in: tenantIds } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, label: true, tenantId: true, keyPrefix: true,
      status: true, createdAt: true, revokedAt: true, lastUsedAt: true,
    },
  })
  return { tenants, keys: rows }
}

/**
 * Revoke a key. Takes effect on the next request — no grace period (the
 * ADR-047 D4 reasoning holds identically here: no user is attached to a
 * service credential to notice a compromise). Same authority as minting,
 * checked against the key's own Tenant. An unknown id and a key the viewer
 * has no authority over answer identically (404), so the revoke surface is
 * not an enumeration oracle over key ids.
 */
export async function revokeApiAccessKey(id, { reason = 'REVOKED', viewer, db = prisma } = {}) {
  if (typeof id !== 'string' || !id.trim()) throw failure(404, 'API_ACCESS_KEY_NOT_FOUND')
  const row = await db.apiAccessKey.findUnique({
    where: { id },
    select: { id: true, tenantId: true, label: true, status: true },
  })
  if (!row || !mayGovernKeys(viewer, row.tenantId)) throw failure(404, 'API_ACCESS_KEY_NOT_FOUND')

  const result = await db.apiAccessKey.updateMany({
    where: { id: row.id, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason },
  })
  const revoked = result.count > 0
  if (revoked) {
    await recordAudit(db, {
      entityType: 'ApiAccessKey',
      entityId: row.id,
      action: 'API_ACCESS_KEY_REVOKED',
      payload: { tenantId: row.tenantId, label: row.label, reason },
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
 * Resolve a request's Enterprise API viewer from its `Authorization: Bearer`
 * header. Returns `null` — never throws — whenever the header names a
 * different identity than this one: absent, not an `apik_`-prefixed token, or
 * a token that does not match an active key. Deliberately the exact
 * fall-through shape `resolveSotDataPlaneViewer` established (ADR-047 D3):
 * every `null` is the caller's cue to try `resolveRequestViewer` (session
 * auth) next, so an invalid, revoked or missing key all end at the identical
 * generic refusal that a request with no credential gets — the endpoint is
 * not an enumeration oracle over keys (FR-106).
 */
export async function resolveApiAccessViewer(request, { db = prisma } = {}) {
  const token = bearerToken(request)
  if (!token || !token.startsWith(`${API_ACCESS_KEY_PREFIX}_`)) return null

  const row = await db.apiAccessKey.findUnique({ where: { keyHash: hashKey(token) } })
  if (!row || row.status !== 'ACTIVE') return null

  await db.apiAccessKey.updateMany({
    where: { id: row.id, status: 'ACTIVE' },
    data: { lastUsedAt: new Date() },
  })

  return { isApiAccess: true, tenantId: row.tenantId, serviceAccountId: row.id }
}
