import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { ZodError } from 'zod'

import { MarketRefusal } from '../ports/contracts.js'
import {
  getMarketObservationFeed,
  parseMarketObservationFeedQuery,
} from '../core/observation-feed.js'
import {
  parseMarketTranslationRunInput,
  runMarketTranslationForBusiness,
} from '../core/translation-run.js'
import { extractGenericMarketCandidate } from '../core/generic-candidate-extractor.js'
import { CoreUnavailable, SUBJECT_HEADER } from '../adapters/core-client.js'
import { LineageScopeCollision } from '../adapters/observation-schema.js'

// Market Intelligence service HTTP API v1 (ADR-108 D5). The caller is the console BFF,
// authenticated with its own bearer token; the end user's credential arrives in
// x-zuri-subject and is handed to core untouched. Response bodies and error shapes
// match the legacy Next routes ({ error, issues? }), so the BFF can pass them through.
//
//   GET  /healthz                     process is up
//   GET  /readyz                      store + core + ownership answer
//   GET  /v1/observations?businessId  scoped feed (feed version 1.0)
//   POST /v1/translations             owner-initiated translation run (64 KiB body cap)
// @req FR-092, NFR-018
// @spec BR-001, SEC-001, SEC-017, SDD-049, ADR-108
// @tested services/market-intelligence/test/http-api.test.js

export const MAX_BODY_BYTES = 64 * 1024

function send(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function tokenMatches(header, expected) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const wanted = Buffer.from(expected)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body too large'), { status: 413 })
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('Request body must be JSON'), { status: 400 })
  }
}

function toErrorResponse(error, log) {
  if (error instanceof ZodError) {
    return [400, { error: 'Validation failed', issues: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }]
  }
  if (error instanceof MarketRefusal) return [error.status, { error: error.message }]
  if (error instanceof CoreUnavailable) {
    // ADR-108 D7: an operator must be able to tell "nothing was written" from
    // "observations committed, audit event lost" without reading code.
    const phase = error.phase ?? 'before-write'
    const committed = error.committed === true
    if (committed) log('error', 'audit append failed after commit', { phase, reason: error.reason })
    return [503, { error: error.message, code: error.code, phase, committed }]
  }
  if (error instanceof LineageScopeCollision) {
    log('error', 'lineage scope collision', { error: error.message })
    return [500, { error: 'Internal error', code: 'INTERNAL' }]
  }
  if ([400, 401, 409, 413, 502].includes(error?.status)) {
    return [error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) }]
  }
  log('error', 'unhandled request error', { error: error?.message })
  return [500, { error: 'Internal error', code: 'INTERNAL' }]
}

/**
 * @param {object} deps
 * @param {object} deps.config          validated config (apiToken, production, assumeExecutionOwner)
 * @param {object} deps.storeFactory    { kind, open, ping }
 * @param {object} deps.core            core client (scopeAuthority, rawEvidence, audit, executionOwnership, health)
 */
export function createMarketHttpServer({ config, storeFactory, core, now, log = () => {} }) {
  let draining = false

  async function readiness() {
    const deps = { store: storeFactory.kind, core: 'unknown' }
    try {
      await storeFactory.ping()
    } catch {
      return [503, { ready: false, reason: 'STORE_UNAVAILABLE', deps }]
    }
    try {
      const health = await core.health()
      deps.core = health.mode
      if (!health.ok) return [503, { ready: false, reason: 'CORE_UNHEALTHY', deps }]
      if (config.production && health.mode !== 'remote') {
        return [503, { ready: false, reason: 'CORE_NOT_PRODUCTION', deps }]
      }
      const ownership = await core.executionOwnership()
      return [200, { ready: true, deps, ownsTranslation: ownership.ownsTranslation }]
    } catch {
      return [503, { ready: false, reason: 'CORE_UNAVAILABLE', deps }]
    }
  }

  async function route(request, response) {
    const url = new URL(request.url, 'http://market.invalid')

    if (request.method === 'GET' && url.pathname === '/healthz') return send(response, 200, { status: 'ok' })
    if (request.method === 'GET' && url.pathname === '/readyz') {
      if (draining) return send(response, 503, { ready: false, reason: 'DRAINING' })
      const [status, body] = await readiness()
      return send(response, status, body)
    }

    if (!url.pathname.startsWith('/v1/')) return send(response, 404, { error: 'Not found' })
    if (!tokenMatches(request.headers.authorization, config.apiToken)) {
      return send(response, 401, { error: 'Authentication required' })
    }
    const subject = request.headers[SUBJECT_HEADER]
    if (typeof subject !== 'string' || !subject) return send(response, 401, { error: 'Authentication required' })
    const actor = { subject }

    if (request.method === 'GET' && url.pathname === '/v1/observations') {
      const query = parseMarketObservationFeedQuery(Object.fromEntries(url.searchParams.entries()))
      const feed = await getMarketObservationFeed(
        { actor, ...query },
        { scopeAuthority: core.scopeAuthority, openObservationStore: storeFactory.open },
      )
      return send(response, 200, feed)
    }

    if (request.method === 'POST' && url.pathname === '/v1/translations') {
      const input = parseMarketTranslationRunInput(await readJson(request))
      const ownership = config.assumeExecutionOwner ? { ownsTranslation: true } : await core.executionOwnership()
      if (!ownership.ownsTranslation) {
        throw Object.assign(new Error('Market service does not own translation execution'), {
          status: 409,
          code: 'MARKET_NOT_EXECUTION_OWNER',
        })
      }
      const result = await runMarketTranslationForBusiness(
        { actor, ...input },
        {
          scopeAuthority: core.scopeAuthority,
          rawEvidence: { listMarketCandidates: (query) => core.rawEvidence.listMarketCandidates({ ...query, subject }) },
          openObservationStore: storeFactory.open,
          audit: {
            // The run appends audit only after its writes, so a failure here means
            // the observations are already committed.
            async record(event) {
              try {
                await core.audit.record(event)
              } catch (error) {
                throw Object.assign(error, { phase: 'audit', committed: true })
              }
            },
          },
          extractCandidate: extractGenericMarketCandidate,
          now,
        },
      )
      return send(response, 200, result)
    }

    return send(response, 404, { error: 'Not found' })
  }

  const server = createServer((request, response) => {
    route(request, response).catch((error) => {
      const [status, body] = toErrorResponse(error, log)
      if (!response.headersSent) send(response, status, body)
      else response.destroy()
    })
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000

  return {
    server,
    listen(port, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => resolve(server.address()))
      })
    },
    /** Stop taking work, let in-flight requests finish, then close. */
    close() {
      draining = true
      return new Promise((resolve) => {
        server.close(() => resolve())
        server.closeIdleConnections?.()
      })
    },
  }
}
