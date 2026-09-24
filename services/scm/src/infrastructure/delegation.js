import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

// Delegated scope — the PROPOSED SCM-CORE contract (scm.delegation.v1), not frozen.
//
// The SCM process never resolves a viewer itself and never trusts role, owner or
// "verified" flags from a request body. The core (Identity owner, via the BFF)
// resolves the viewer exactly as today (resolveViewer → grants, domains, RBAC
// permissions) and signs a short-lived statement of what that viewer holds for
// the Businesses the request names. SCM verifies signature, audience, issuer and
// expiry, then applies the SAME ladder the legacy authority modules apply:
//   procurement view     : grant exists + domain 'procurement'
//   PO / supplier write  : owner | 'procurement.po.write'
//   post goods receipt   : owner | 'procurement.receipt.post'
//   inventory manage     : domain 'inventory' + (owner | 'inventory.catalog.write')
// A refusal of scope is the same 404 an unknown Business gets (FR-072).
// `visible(businessId)` = the legacy seesBusiness: a grant exists for that Business
// (any domain). The core therefore issues a grant for every Business the actor can
// see that a request may touch (a customer's or conversation's home Business too).
// Revocation window = token lifetime (maxLifetimeSeconds, default 120s): a
// membership revoked in core stops working at the next token, not mid-request.
// The service identity that transports the token is NOT a business authority.

const zGrant = z.object({
  owner: z.boolean(),
  domains: z.array(z.string().min(1).max(64)).max(64),
  permissions: z.array(z.string().min(1).max(128)).max(128),
}).strict()

const zClaims = z.object({
  v: z.literal(1),
  iss: z.string().min(1).max(100),
  aud: z.literal('zuri-scm'),
  sub: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(8).max(200),
  grants: z.record(z.string().min(1).max(200), zGrant).refine((g) => Object.keys(g).length <= 50, 'at most 50 Businesses per delegation'),
}).strict()

const b64 = (buf) => Buffer.from(buf).toString('base64url')
const sign = (key, body) => createHmac('sha256', key).update(body).digest()

export function denied(status = 404, code = 'SCM_SCOPE_NOT_FOUND', message = 'Business not found') {
  return Object.assign(new Error(message), { status, code, retryable: false })
}

/** Issued by the core façade (and by test issuers with synthetic keys only). */
export function signDelegation(claims, key) {
  const body = b64(JSON.stringify(claims))
  return `${body}.${b64(sign(key, body))}`
}

export function createDelegationVerifier({ key, issuer = 'zuri-core', maxLifetimeSeconds = 120, clockSkewSeconds = 5, now = () => Date.now() }) {
  if (!key || Buffer.byteLength(key) < 32) throw Object.assign(new Error('delegation key must be at least 32 bytes'), { code: 'SCM_CONFIG_INVALID' })
  return function verify(token) {
    const unauthorized = (reason) => Object.assign(new Error('delegation rejected'), { status: 401, code: 'SCM_DELEGATION_INVALID', reason, retryable: false })
    if (typeof token !== 'string' || token.length > 16384) throw unauthorized('shape')
    const [body, mac, extra] = token.split('.')
    if (!body || !mac || extra !== undefined) throw unauthorized('shape')
    const expected = sign(key, body)
    const given = Buffer.from(mac, 'base64url')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized('signature')
    let claims
    try { claims = zClaims.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))) } catch { throw unauthorized('claims') }
    const t = Math.floor(now() / 1000)
    if (claims.iss !== issuer) throw unauthorized('issuer')
    if (claims.exp < t - clockSkewSeconds) throw Object.assign(unauthorized('expired'), { code: 'SCM_DELEGATION_EXPIRED' })
    if (claims.iat > t + clockSkewSeconds || claims.exp - claims.iat > maxLifetimeSeconds) throw unauthorized('lifetime')
    return scopeFrom(claims)
  }
}

function scopeFrom(claims) {
  const grant = (businessId) => (typeof businessId === 'string' && Object.hasOwn(claims.grants, businessId) ? claims.grants[businessId] : null)
  const scope = {
    actorId: claims.sub,
    tenantId: claims.tenantId,
    delegationId: claims.jti,
    visible: (businessId) => Boolean(grant(businessId)),
    sees: (businessId, domain) => { const g = grant(businessId); return Boolean(g && g.domains.includes(domain)) },
    owns: (businessId) => Boolean(grant(businessId)?.owner),
    has: (businessId, permission) => Boolean(grant(businessId)?.permissions.includes(permission)),
  }
  return Object.freeze(scope)
}

// ── The ladder, one function per capability (legacy parity) ──────────────────
export const PERMISSIONS = Object.freeze({
  INVENTORY_MANAGE: 'inventory.catalog.write',
  PURCHASE_ORDER_WRITE: 'procurement.po.write',
  GOODS_RECEIPT_POST: 'procurement.receipt.post',
})

export const procurementAuthority = {
  mayView: (scope, businessId) => scope.sees(businessId, 'procurement'),
  mayWritePurchaseOrders: (scope, businessId) => scope.owns(businessId) || scope.has(businessId, PERMISSIONS.PURCHASE_ORDER_WRITE),
  mayPostReceipts: (scope, businessId) => scope.owns(businessId) || scope.has(businessId, PERMISSIONS.GOODS_RECEIPT_POST),
  /** Mirrors procurement-authority.loadBusiness: every refusal is the not-found 404. */
  require(scope, businessId, capability = 'read') {
    if (!this.mayView(scope, businessId)) throw denied()
    if (capability === 'po' && !this.mayWritePurchaseOrders(scope, businessId)) throw denied()
    if (capability === 'receipt' && !this.mayPostReceipts(scope, businessId)) throw denied()
    return { id: businessId, tenantId: scope.tenantId }
  },
}

export const inventoryAuthority = {
  mayView: (scope, businessId) => scope.sees(businessId, 'inventory'),
  mayManage: (scope, businessId) => scope.owns(businessId) || scope.has(businessId, PERMISSIONS.INVENTORY_MANAGE),
  require(scope, businessId, { write = false } = {}) {
    if (!this.mayView(scope, businessId)) throw denied()
    if (write && !this.mayManage(scope, businessId)) throw denied()
    return { id: businessId, tenantId: scope.tenantId }
  },
}

// Commerce (commerce-authority.js parity): view = domain 'commerce'; orders and
// payment recording = owner | 'commerce.order.write'; verify/reject = owner |
// 'commerce.payment.verify'.
export const COMMERCE_PERMISSIONS = Object.freeze({ ORDER_WRITE: 'commerce.order.write', PAYMENT_VERIFY: 'commerce.payment.verify' })

export const commerceAuthority = {
  mayView: (scope, businessId) => scope.sees(businessId, 'commerce'),
  mayWriteOrders: (scope, businessId) => scope.owns(businessId) || scope.has(businessId, COMMERCE_PERMISSIONS.ORDER_WRITE),
  mayVerifyPayments: (scope, businessId) => scope.owns(businessId) || scope.has(businessId, COMMERCE_PERMISSIONS.PAYMENT_VERIFY),
  require(scope, businessId, capability = 'read') {
    const id = typeof businessId === 'string' ? businessId.trim() : ''
    if (!id || !this.mayView(scope, id)) throw denied()
    if (capability === 'order' && !this.mayWriteOrders(scope, id)) throw denied()
    if (capability === 'verify' && !this.mayVerifyPayments(scope, id)) throw denied()
    return { id, tenantId: scope.tenantId }
  },
}
