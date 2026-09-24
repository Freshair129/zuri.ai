import { z } from 'zod'

import {
  MARKET_ACTIONS,
  assertObservationStore,
  assertObservationStoreFactory,
  assertScopeAuthorityPort,
  authorizeScope,
} from '../ports/contracts.js'

// The `/market` read contract, ported from apps/server's getMarketObservationFeed
// with the same query limits, row presentation and response shape (feed version 1.0).
// What changed is only where authority comes from: the Identity predicates, domain
// gate and Business lookup are one ScopeAuthorityPort call, so this file imports no
// foreign domain and no database.
// @req FR-092, FR-061
// @spec BR-001, SEC-001, SEC-017, SDD-049, ADR-038
// @tested services/market-intelligence/test/observation-feed.test.js,
//   services/market-intelligence/test/parity-vectors.test.js

export const MARKET_OBSERVATION_FEED_VERSION = '1.0'
export const MARKET_OBSERVATION_FEED_LIMIT = 50
export const MARKET_OBSERVATION_FEED_MAX_LIMIT = 200

export const trimmedId = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  z.string().min(1),
)

export function optionalLimit(max) {
  return z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().int().positive()
      .transform((value) => Math.min(value, max))
      .optional(),
  )
}

export const zMarketObservationFeedQuery = z.object({
  businessId: trimmedId,
  limit: optionalLimit(MARKET_OBSERVATION_FEED_MAX_LIMIT),
}).strict()

export function parseMarketObservationFeedQuery(query = {}) {
  const parsed = zMarketObservationFeedQuery.parse(query)
  return { businessId: parsed.businessId, limit: parsed.limit ?? MARKET_OBSERVATION_FEED_LIMIT }
}

function parseCandidate(candidateJson) {
  // A row the write path did not validate degrades to "no candidate detail" for that
  // row instead of failing the whole page.
  try {
    const candidate = JSON.parse(candidateJson)
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null
  } catch {
    return null
  }
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// External payload: nothing is assumed to exist or carry the type its name suggests.
// A missing title stays null; it never becomes an invented string.
function presentCandidate(candidate) {
  if (!candidate) return { title: null, price: null, currency: null, seller: null, condition: null }
  return {
    title: text(candidate.title) ?? text(candidate.name) ?? text(candidate.productTitle),
    price: finite(candidate.unitPrice) ?? finite(candidate.price) ?? finite(candidate.rawPrice),
    currency: text(candidate.currency),
    seller: text(candidate.sellerName) ?? text(candidate.seller),
    condition: text(candidate.condition),
  }
}

export function toFeedRow(observation) {
  const candidate = parseCandidate(observation.candidateJson)
  return {
    id: observation.id,
    provider: observation.provider,
    observationType: observation.observationType,
    sourceEntityType: observation.sourceEntityType,
    externalId: observation.externalId,
    sourceUri: observation.sourceUri ?? null,
    translationSchemaVersion: observation.translationSchemaVersion,
    resolutionStatus: observation.resolutionStatus,
    resolutionConfidence: observation.resolutionConfidence ?? null,
    canonicalProductRef: observation.canonicalProductRef ?? null,
    canonicalCategoryRef: observation.canonicalCategoryRef ?? null,
    observedAt: new Date(observation.observedAt).toISOString(),
    translatedAt: new Date(observation.translatedAt).toISOString(),
    ...presentCandidate(candidate),
    candidate,
  }
}

function assertRowInScope(row, scope) {
  if (row.tenantId !== undefined && row.tenantId !== scope.tenantId) {
    throw new Error('ObservationStore returned a row outside the authorized tenant')
  }
  if (row.businessId !== undefined && (row.businessId ?? null) !== scope.businessId) {
    throw new Error('ObservationStore returned a row outside the authorized Business')
  }
}

/**
 * This actor's translated observations for one Business, newest first.
 *
 * Tenant-shared rows (businessId null) are not folded in: an observation inherits the
 * Business of the connection that produced it, so widening would show a Business rows
 * it does not own. The store is opened with exactly the authorized scope, and every
 * returned row is re-checked against it.
 */
export async function getMarketObservationFeed(
  { actor, businessId, limit = MARKET_OBSERVATION_FEED_LIMIT } = {},
  { scopeAuthority, openObservationStore } = {},
) {
  assertScopeAuthorityPort(scopeAuthority)
  assertObservationStoreFactory(openObservationStore)

  const scope = await authorizeScope(scopeAuthority, {
    actor,
    businessId,
    action: MARKET_ACTIONS.FEED_READ,
  })

  const store = assertObservationStore(
    await openObservationStore({ tenantId: scope.tenantId, businessId: scope.businessId }),
    ['listRecent'],
  )

  const rows = await store.listRecent({ limit })
  for (const row of rows) assertRowInScope(row, scope)
  const observations = rows.map(toFeedRow)

  const byResolutionStatus = {}
  const providers = new Set()
  for (const row of observations) {
    providers.add(row.provider)
    byResolutionStatus[row.resolutionStatus] = (byResolutionStatus[row.resolutionStatus] || 0) + 1
  }

  return {
    version: MARKET_OBSERVATION_FEED_VERSION,
    scope: { businessId: scope.businessId, businessName: scope.businessName ?? null, tenantId: scope.tenantId },
    counts: {
      observations: observations.length,
      providers: providers.size,
      byResolutionStatus,
    },
    limit,
    truncated: observations.length === limit,
    observations,
  }
}
