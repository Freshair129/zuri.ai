import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { AUTH_SESSION_COOKIE } from '@/modules/identity/auth-service'
import {
  GOODS_RECEIPT_POST_PERMISSION,
  hasPermission,
  INVENTORY_MANAGE_PERMISSION,
  ORDER_WRITE_PERMISSION,
  PAYMENT_VERIFY_PERMISSION,
  PURCHASE_ORDER_WRITE_PERMISSION,
} from '@/modules/identity/rbac'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { mayView as commerceMayView } from '@/modules/commerce/application/commerce-authority'
import { mayView as procurementMayView } from '@/modules/procurement/application/procurement-authority'
import { mayView as inventoryMayView } from './inventory-authority'

// Core's side (the provider) of contract scm-core.v1 (services/scm/contracts/v1/
// scm-core.v1.json), consumed by the separately running SCM service at
// /api/internal/scm/v1/<operation> — ADR-111 D5, built on the ADR-108 D4 pattern
// of the Market façade (market-core-facade.js). Core stays the only identity
// authority: SCM authenticates with SCM_CORE_TOKEN, and the end user is identified
// only by re-resolving their own session token (x-zuri-subject) through the normal
// request-viewer path. A viewer, role, owner flag or tenantId sent by the service is
// never read — the request bodies are strict and carry none of them.
//
// resolve-scope reproduces the legacy decisions by CALLING the legacy predicates,
// not by re-deriving them, so the SCM ladder (services/scm delegation.js) applied
// to these grants answers exactly what the in-process authorities answer:
//   grant present  = seesBusiness                    (SCM `visible`)
//   owner          = ownsBusiness                    (SCM `owns`)
//   domains        = inventory / procurement / commerce authority `mayView`
//                    (seesBusiness + assertDomainVisible, FR-061)
//   permissions    = hasPermission for the five SCM permission keys only
// Nothing else leaves core: no other domain key and no other permission.
//
// The scope carries ONE tenantId (the consumer derives every write's Tenant from
// it), while a viewer may see Businesses of several Tenants. A grant for a Business
// of another Tenant would make SCM write that Business's rows under the wrong
// Tenant, so a viewer whose visible Businesses do not lie in exactly one Tenant is
// refused with 409 SCOPE_NOT_SINGLE_TENANT (the consumer maps it to 502
// SCM_CORE_REJECTED, no effect) rather than answered with a partial or a guessed
// Tenant. Recorded as an open question for the Core owner.
//
// Facts (branch, branches, customer, conversation): the subject is re-resolved on
// every call. A Business the subject cannot see, a missing row, a row of another
// Tenant, or a row homed in a Business the subject cannot see is `null` (branches:
// []) — never 403/404, so existence is not disclosed. Otherwise the raw columns are
// returned and SCM applies the legacy predicates (status, deletedAt, Business).
// The reads are the same ones the legacy commerce services make
// (pos-cashier-service resolveLocation / branch list, sales-order-service
// requireCustomer / requireConversation).
//
// Refusals use the contract's `{error:{code}}` body. Nothing here logs the subject
// or the token.
// @req FR-154, FR-164, FR-165, FR-166, FR-163, FR-183, FR-061
// @spec ADR-111, ADR-108, BR-001, SEC-001, SEC-017, BR-020, FR-072
// @tested tests/unit/scm-core-facade.test.js, tests/integration/scm-core-facade-http.test.js

export const SCM_CORE_CONTRACT_VERSION = 'scm-core.v1'
export const SCM_CORE_OPERATIONS = Object.freeze(['resolve-scope', 'branch', 'branches', 'customer', 'conversation'])
export const MAX_REQUEST_BODY_BYTES = 16 * 1024
export const MAX_GRANTS = 500
export const MAX_BRANCHES = 1000
export const SUBJECT_MAX_LENGTH = 4096

/** The only domains and permissions SCM's ladders read (delegation.js). */
export const SCM_DOMAINS = Object.freeze(['inventory', 'procurement', 'commerce'])
export const SCM_PERMISSIONS = Object.freeze([
  INVENTORY_MANAGE_PERMISSION,
  PURCHASE_ORDER_WRITE_PERMISSION,
  GOODS_RECEIPT_POST_PERMISSION,
  ORDER_WRITE_PERMISSION,
  PAYMENT_VERIFY_PERMISSION,
])
const DOMAIN_VIEW = Object.freeze({
  inventory: inventoryMayView,
  procurement: procurementMayView,
  commerce: commerceMayView,
})

const id = z.string().min(1).max(200)
const BODIES = Object.freeze({
  'resolve-scope': z.object({}).strict(),
  branch: z.object({ businessId: id, branchId: id }).strict(),
  branches: z.object({ businessId: id }).strict(),
  customer: z.object({ businessId: id, customerId: id }).strict(),
  conversation: z.object({ businessId: id, conversationId: id }).strict(),
})

const ok = (data) => ({ status: 200, body: { contractVersion: SCM_CORE_CONTRACT_VERSION, ok: true, data } })
export const fail = (status, code) => ({ status, body: { error: { code } } })

/** Timing-safe; an unset or short (< 32) SCM_CORE_TOKEN refuses every caller. */
export function tokenMatches(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false
  const supplied = Buffer.from(typeof header === 'string' ? header : '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

/**
 * Re-resolve the user from their own session token, exactly as a browser request
 * would be. `null` = not a live session (resolveRequestViewer throws a 401 for a
 * missing, expired, revoked or malformed one). Any other failure is a fault and
 * propagates (the route answers 503).
 */
async function viewerForSubject(subject, resolveRequestViewer) {
  if (typeof subject !== 'string' || !subject || subject.length > SUBJECT_MAX_LENGTH || /[;\r\n]/.test(subject)) return null
  const request = new Request('http://scm-core.internal/', { headers: { cookie: `${AUTH_SESSION_COOKIE}=${subject}` } })
  try {
    return await resolveRequestViewer(request)
  } catch (error) {
    if (Number(error?.status) === 401) return null
    throw error
  }
}

/**
 * Read a request body without buffering past `maxBytes` (the market façade's
 * approach): a declared Content-Length over the cap is refused before reading, and
 * the stream is cancelled as soon as the running total passes it.
 * @returns {Promise<{ok: true, body: object} | {ok: false, status: number, code: string}>}
 */
export async function readBoundedBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  const tooLarge = { ok: false, status: 413, code: 'REQUEST_TOO_LARGE' }
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge
  const chunks = []
  let total = 0
  if (request.body) {
    const reader = request.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return tooLarge
      }
      chunks.push(value)
    }
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
  try {
    return { ok: true, body: text ? JSON.parse(text) : {} }
  } catch {
    return { ok: false, status: 400, code: 'VALIDATION_FAILED' }
  }
}

/** The legacy grant for one Business, from the legacy predicates themselves. */
export function grantFor(viewer, businessId) {
  return {
    owner: ownsBusiness(viewer, businessId),
    domains: SCM_DOMAINS.filter((domain) => DOMAIN_VIEW[domain](viewer, businessId)),
    permissions: SCM_PERMISSIONS.filter((permission) => hasPermission(viewer, businessId, permission)),
  }
}

async function resolveScope(viewer, db) {
  const visible = Array.isArray(viewer?.visibleBusinessIds)
    ? [...new Set(viewer.visibleBusinessIds.filter((value) => typeof value === 'string' && value))]
    : []
  if (visible.length > MAX_GRANTS) return fail(409, 'SCOPE_TOO_LARGE')
  const rows = visible.length
    ? await db.business.findMany({ where: { id: { in: visible } }, select: { id: true, tenantId: true } })
    : []
  const tenants = [...new Set(rows.map((row) => row.tenantId))]
  if (tenants.length !== 1) return fail(409, 'SCOPE_NOT_SINGLE_TENANT')
  const existing = new Set(rows.map((row) => row.id))
  const grants = {}
  // A Business in visibleBusinessIds that no longer exists is left out: legacy
  // loadBusiness answers it the same 404 a missing grant gets in SCM.
  for (const businessId of visible) {
    if (existing.has(businessId) && seesBusiness(viewer, businessId)) grants[businessId] = grantFor(viewer, businessId)
  }
  return ok({ actorId: viewer.principal.id, tenantId: tenants[0], grants })
}

/** The named Business, only when the subject can see it; otherwise null (non-enumeration). */
async function visibleBusiness(viewer, db, businessId) {
  if (!seesBusiness(viewer, businessId)) return null
  return db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
}

/** A row is disclosed only inside the named Business's Tenant and a home Business the subject sees. */
function disclosed(viewer, business, row) {
  if (!row || row.tenantId !== business.tenantId) return false
  return !row.businessId || seesBusiness(viewer, row.businessId)
}

const iso = (value) => (value ? new Date(value).toISOString() : null)

async function answerFact(operation, input, viewer, db) {
  const business = await visibleBusiness(viewer, db, input.businessId)

  if (operation === 'branches') {
    if (!business) return ok({ branches: [] })
    const rows = await db.branch.findMany({
      where: { tenantId: business.tenantId, businessId: business.id },
      orderBy: [{ code: 'asc' }],
      take: MAX_BRANCHES + 1,
      select: { id: true, code: true, name: true, address: true, kind: true, status: true, tenantId: true, businessId: true },
    })
    // Truncating would silently drop a Branch; the bound is the contract's, so refuse.
    if (rows.length > MAX_BRANCHES) return fail(409, 'BRANCHES_TOO_MANY')
    return ok({ branches: rows.map((row) => ({ ...row, address: row.address ?? null })) })
  }

  if (!business) return ok({ fact: null })

  if (operation === 'branch') {
    const row = await db.branch.findUnique({
      where: { id: input.branchId },
      select: { id: true, code: true, name: true, tenantId: true, businessId: true, status: true },
    })
    return ok({ fact: disclosed(viewer, business, row) ? row : null })
  }

  if (operation === 'customer') {
    const row = await db.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, code: true, tenantId: true, businessId: true, deletedAt: true },
    })
    return ok({ fact: disclosed(viewer, business, row) ? { ...row, businessId: row.businessId ?? null, deletedAt: iso(row.deletedAt) } : null })
  }

  const row = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, tenantId: true, businessId: true, customerId: true },
  })
  return ok({ fact: disclosed(viewer, business, row) ? { ...row, businessId: row.businessId ?? null, customerId: row.customerId ?? null } : null })
}

/**
 * @param {object} request  { method, operation, authorization, subject, body }
 * @param {object} deps     { db, env, resolveRequestViewer }
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleScmCoreRequest(
  { method, operation, authorization, subject, body },
  { db, env, resolveRequestViewer },
) {
  // The service credential first: an unauthenticated caller learns nothing, not
  // even which operations exist.
  if (!tokenMatches(authorization, env?.SCM_CORE_TOKEN)) return fail(401, 'SERVICE_TOKEN_INVALID')
  if (!SCM_CORE_OPERATIONS.includes(operation)) return fail(404, 'OPERATION_NOT_FOUND')
  if (method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED')

  const parsed = BODIES[operation].safeParse(body ?? {})
  if (!parsed.success) return fail(400, 'VALIDATION_FAILED')

  const viewer = await viewerForSubject(subject, resolveRequestViewer)
  if (!viewer || typeof viewer.principal?.id !== 'string' || !viewer.principal.id) return fail(401, 'SUBJECT_UNAUTHENTICATED')

  if (operation === 'resolve-scope') return resolveScope(viewer, db)
  return answerFact(operation, parsed.data, viewer, db)
}
