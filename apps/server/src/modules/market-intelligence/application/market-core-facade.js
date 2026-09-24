import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { AUTH_SESSION_COOKIE } from '@/modules/identity/auth-service'

// DRAFT FOR THE INTEGRATOR (ADR-108 D4, M3(b)). This is core's side of the market-core.v1
// contract the Market service consumes at /api/internal/market-intelligence/v1/*.
// Core stays the single authority. The service authenticates with MARKET_CORE_TOKEN,
// and the end user is identified only by re-resolving their own session token
// (x-zuri-subject) through the normal request-viewer path. A viewer, role or tenantId
// sent by the service is never accepted.
//
// The decisions reproduce getMarketObservationFeed / runMarketTranslationForBusiness
// in the same order, so refusal statuses and FR-072 disclosure discipline do not change
// when execution moves:
//   feed read   : !seesBusiness → 403 'Business access denied'; Market domain hidden
//                 or unknown Business → 404 'Business not found'
//   translation : unknown Business, domain hidden or not owner → identical 404
// raw-candidates re-authorizes the subject for translation and checks the tenant, so a
// service token alone can never read another Business's raw evidence.
// @req FR-092, FR-061
// @spec BR-001, SEC-001, SEC-017, SDD-049, ADR-108
// @tested tests/unit/market-intelligence/market-core-facade.test.js

export const MARKET_CORE_CONTRACT_VERSION = 'market-core.v1'
export const MARKET_CORE_OPERATIONS = Object.freeze({
  GET: ['health', 'execution-ownership'],
  POST: ['authorize', 'raw-candidates', 'audit'],
})
const ACTIONS = ['market.feed.read', 'market.translation.run']
const MAX_SCAN_LIMIT = 500

const zAuthorize = z.object({ businessId: z.string().min(1).max(200), action: z.enum(ACTIONS) }).strict()
const zRawCandidates = z.object({
  tenantId: z.string().min(1).max(200),
  businessId: z.string().min(1).max(200),
  scanLimit: z.number().int().positive().max(MAX_SCAN_LIMIT),
}).strict()
const count = z.number().int().nonnegative()
const zAudit = z.object({
  entityType: z.literal('MARKET_OBSERVATION'),
  entityId: z.string().min(1).max(200),
  action: z.literal('MARKET_TRANSLATION_RUN'),
  payload: z.object({
    businessId: z.string().min(1).max(200),
    candidates: count, eligible: count, translated: count, unchanged: count, failed: count,
  }).strict(),
}).strict()

const ok = (data) => ({ status: 200, body: { contractVersion: MARKET_CORE_CONTRACT_VERSION, ok: true, data } })
const fail = (status, error) => ({ status, body: { error } })

function tokenMatches(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false
  const supplied = Buffer.from(typeof header === 'string' ? header : '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

/** Re-resolve the user from their own session token, exactly as a browser request would be. */
async function viewerForSubject(subject, resolveRequestViewer) {
  if (typeof subject !== 'string' || !subject || subject.length > 8192 || /[;\r\n]/.test(subject)) return null
  const request = new Request('http://market-core.internal/', { headers: { cookie: `${AUTH_SESSION_COOKIE}=${subject}` } })
  return resolveRequestViewer(request)
}

async function decide({ viewer, businessId, action, db }) {
  const refuse = (status, message) => ({ allowed: false, status, message })
  const lookup = () => db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true, name: true } })

  if (action === 'market.feed.read') {
    if (!seesBusiness(viewer, businessId)) return refuse(403, 'Business access denied')
    try { assertDomainVisible(viewer, businessId, 'market') } catch { return refuse(404, 'Business not found') }
    const business = await lookup()
    if (!business) return refuse(404, 'Business not found')
    return { allowed: true, scope: { tenantId: business.tenantId, businessId: business.id, businessName: business.name } }
  }

  const business = await lookup()
  if (!business) return refuse(404, 'Business not found')
  try { assertDomainVisible(viewer, businessId, 'market') } catch { return refuse(404, 'Business not found') }
  if (!ownsBusiness(viewer, businessId)) return refuse(404, 'Business not found')
  return { allowed: true, scope: { tenantId: business.tenantId, businessId: business.id, businessName: business.name } }
}

function serializeRaw(row) {
  return {
    ...row,
    receivedAt: row.receivedAt ? new Date(row.receivedAt).toISOString() : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
  }
}

/**
 * @param {object} request  { method, operation, authorization, subject, body }
 * @param {object} deps     { db, env, resolveRequestViewer, listCandidates, recordAudit }
 * @returns {Promise<{status: number, body: object}>}
 */
export async function handleMarketCoreRequest(
  { method, operation, authorization, subject, body },
  { db, env, resolveRequestViewer, listCandidates, recordAudit },
) {
  if (!MARKET_CORE_OPERATIONS[method]?.includes(operation)) return fail(404, 'Not found')
  if (!tokenMatches(authorization, env.MARKET_CORE_TOKEN)) return fail(401, 'MARKET_CORE_CREDENTIAL_REQUIRED')

  if (operation === 'health') return ok({ ok: true, mode: 'remote' })
  // One deployment flag decides both sides of ADR-108 D6: the BFF routes to the
  // service only when this same flag says the service owns execution.
  if (operation === 'execution-ownership') return ok({ ownsTranslation: env.MARKET_EXECUTOR === 'service' })

  let input
  try {
    input = (operation === 'authorize' ? zAuthorize : operation === 'raw-candidates' ? zRawCandidates : zAudit).parse(body)
  } catch {
    return fail(400, 'Validation failed')
  }

  if (operation === 'audit') {
    // No subject needed: the event carries counts only, and the service can only
    // report runs it performed. The audit owner's durable-intake contract is M4.
    await recordAudit(db, input)
    return ok({ recorded: true })
  }

  const viewer = await viewerForSubject(subject, resolveRequestViewer)
  if (!viewer) return fail(401, 'Authentication required')

  if (operation === 'authorize') return ok(await decide({ viewer, businessId: input.businessId, action: input.action, db }))

  const decision = await decide({ viewer, businessId: input.businessId, action: 'market.translation.run', db })
  if (!decision.allowed || decision.scope.tenantId !== input.tenantId) return fail(403, 'Raw evidence scope refused')
  const records = await listCandidates(db, {
    tenantId: decision.scope.tenantId,
    businessId: decision.scope.businessId,
    scanLimit: input.scanLimit,
  })
  return ok({ records: records.map(serializeRaw) })
}
