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
//
// Bounds (S1 review of 85d8fd06, findings 1-3):
//   - raw-candidates returns only the fields the translator reads (RAW_RECORD_FIELDS),
//     never idempotency keys, processing state or artifact links. A payload over
//     MAX_RAW_PAYLOAD_BYTES is withheld and marked `omitted`, and the response stops
//     adding records at MAX_RAW_RESPONSE_BYTES and says `truncated: true`.
//   - request bodies are read through readBoundedBody, which stops at the cap
//     instead of buffering first.
//   - an audit event must name one Business in entityId and payload.businessId, that
//     Business must exist, and the row is written with explicit service attribution
//     and the Business's tenant/business scope columns.
// @req FR-092, FR-061
// @spec BR-001, SEC-001, SEC-017, SDD-049, ADR-108
// @tested tests/unit/market-intelligence/market-core-facade.test.js, tests/integration/market-core-facade-http.test.js

export const MARKET_CORE_CONTRACT_VERSION = 'market-core.v1'
export const MARKET_CORE_OPERATIONS = Object.freeze({
  GET: ['health', 'execution-ownership'],
  POST: ['authorize', 'raw-candidates', 'audit'],
})
const ACTIONS = ['market.feed.read', 'market.translation.run']
const MAX_SCAN_LIMIT = 500
export const MAX_REQUEST_BODY_BYTES = 16 * 1024
export const MAX_RAW_PAYLOAD_BYTES = 256 * 1024
export const MAX_RAW_RESPONSE_BYTES = 8 * 1024 * 1024
export const MARKET_SERVICE_AUDIT_ACTOR = Object.freeze({ actorType: 'MARKET_SERVICE', actorId: 'market-intelligence' })
// Exactly what services/market-intelligence reads from a raw record (translate-raw-record.js,
// translation-run.js). Adding a field here widens the contract; the consumer rejects
// any field it does not expect.
export const RAW_RECORD_FIELDS = Object.freeze([
  'id', 'tenantId', 'businessId', 'connectionId', 'provider', 'lane', 'entityType', 'externalId',
  'sourceType', 'sourceUri', 'schemaVersion', 'payloadJson', 'payloadHash', 'receivedAt',
])

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

/**
 * Re-resolve the user from their own session token, exactly as a browser request would be.
 * `null` means "not a live session". resolveRequestViewer signals that by throwing a 401
 * (missing, expired, revoked, malformed); Q11 found that uncaught, it surfaced as a 500
 * and the service answered 503 where legacy answers 401 AUTH_REQUIRED. Any other failure
 * is still a fault and propagates.
 */
async function viewerForSubject(subject, resolveRequestViewer) {
  if (typeof subject !== 'string' || !subject || subject.length > 8192 || /[;\r\n]/.test(subject)) return null
  const request = new Request('http://market-core.internal/', { headers: { cookie: `${AUTH_SESSION_COOKIE}=${subject}` } })
  try {
    return await resolveRequestViewer(request)
  } catch (error) {
    if (Number(error?.status) === 401) return null
    throw error
  }
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
  const record = {}
  for (const field of RAW_RECORD_FIELDS) record[field] = row[field] ?? null
  record.receivedAt = row.receivedAt ? new Date(row.receivedAt).toISOString() : null
  if (typeof record.payloadJson === 'string' && Buffer.byteLength(record.payloadJson, 'utf8') > MAX_RAW_PAYLOAD_BYTES) {
    record.payloadJson = null
    record.omitted = 'PAYLOAD_TOO_LARGE'
  }
  return record
}

/** Oldest-first prefix of the candidates that fits in MAX_RAW_RESPONSE_BYTES. */
function boundRawRecords(rows) {
  const records = []
  let bytes = 0
  for (const row of rows) {
    const record = serializeRaw(row)
    const size = Buffer.byteLength(JSON.stringify(record), 'utf8') + 1
    if (bytes + size > MAX_RAW_RESPONSE_BYTES) return { records, truncated: true }
    records.push(record)
    bytes += size
  }
  return { records, truncated: false }
}

/**
 * Read a request body without buffering past `maxBytes`: a declared Content-Length over
 * the cap is refused before reading, and the stream is cancelled as soon as the running
 * total passes it.
 * @returns {Promise<{ok: true, body: object} | {ok: false, status: number, error: string}>}
 */
export async function readBoundedBody(request, maxBytes = MAX_REQUEST_BODY_BYTES) {
  const tooLarge = { ok: false, status: 413, error: 'Request body too large' }
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
    return { ok: false, status: 400, error: 'Validation failed' }
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
    // report runs it performed. The row names one existing Business in both places
    // and says the service wrote it; the durable-intake contract is M4 (proposal P1).
    if (input.entityId !== input.payload.businessId) return fail(400, 'Validation failed')
    const business = await db.business.findUnique({ where: { id: input.entityId }, select: { id: true, tenantId: true } })
    if (!business) return fail(404, 'Business not found')
    await recordAudit(db, {
      ...input,
      ...MARKET_SERVICE_AUDIT_ACTOR,
      tenantId: business.tenantId,
      businessId: business.id,
    })
    return ok({ recorded: true })
  }

  const viewer = await viewerForSubject(subject, resolveRequestViewer)
  if (!viewer) {
    // A decision, not a transport error: the service maps it to legacy's 401 body.
    if (operation === 'authorize') return ok({ allowed: false, status: 401, message: 'AUTH_REQUIRED' })
    return fail(403, 'Raw evidence scope refused')
  }

  if (operation === 'authorize') return ok(await decide({ viewer, businessId: input.businessId, action: input.action, db }))

  const decision = await decide({ viewer, businessId: input.businessId, action: 'market.translation.run', db })
  if (!decision.allowed || decision.scope.tenantId !== input.tenantId) return fail(403, 'Raw evidence scope refused')
  const records = await listCandidates(db, {
    tenantId: decision.scope.tenantId,
    businessId: decision.scope.businessId,
    scanLimit: input.scanLimit,
    fields: RAW_RECORD_FIELDS,
  })
  return ok(boundRawRecords(records))
}
