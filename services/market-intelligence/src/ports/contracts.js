// Port contracts for the Market Intelligence service core (M1 proposal, not frozen).
// The core never reaches Identity, Integration, Project Manager audit or Prisma; it
// receives these ports from a composition root and checks their shape here, so a
// wiring mistake fails at start-up rather than as a silent wider read.
//
// Semantics each provider must keep (they are what apps/server does today, so a
// provider that changes them changes user-visible behaviour):
//
//   ScopeAuthorityPort.authorize({ actor, businessId, action })
//     -> { allowed: true, scope: { tenantId, businessId, businessName? } }
//      | { allowed: false, status: 403 | 404, message }
//     action 'market.feed.read'       : not-visible Business -> 403 'Business access
//                                       denied'; Market domain hidden or unknown
//                                       Business -> 404 'Business not found'.
//     action 'market.translation.run' : unknown, domain-hidden and not-owned all answer
//                                       the identical 404 'Business not found' (FR-072
//                                       disclosure discipline).
//     The scope's tenantId comes from the authoritative Business row, never from the
//     caller. A client-sent viewer, role or tenantId grants nothing.
//
//   RawEvidenceReadPort.listMarketCandidates({ tenantId, businessId, scanLimit })
//     -> RawExternalRecord-shaped rows in the MARKET_INTELLIGENCE lane, oldest first,
//        at most scanLimit. Integration stays the owner; this is read-only.
//
//   openObservationStore(scope) -> ObservationStore
//     insertIfAbsent(draft)              atomic on lineageKey; CREATED | UNCHANGED
//     listRecent({ limit })              newest observedAt first, scope-only
//     findTranslatedRawRecordIds(ids)    ids already translated in this scope
//
//   AuditPort.record({ entityType, entityId, action, payload })
//     One event per run. Never receives raw payloads or candidates.
//
//   KnowledgeIdentityReadPort.query({ businessId, queryId, params, limit })
//     Optional. Only the registered 'product_search' query is used.
//
// @req FR-092, NFR-018
// @spec BR-001, BR-019, SEC-001, SEC-017, SDD-049, ADR-038
// @tested services/market-intelligence/test/ports.test.js

export const MARKET_ACTIONS = Object.freeze({
  FEED_READ: 'market.feed.read',
  TRANSLATION_RUN: 'market.translation.run',
})

function requireFunction(port, name, method) {
  if (!port || typeof port[method] !== 'function') {
    throw new TypeError(`${name}.${method} is required`)
  }
}

export function assertScopeAuthorityPort(port) {
  requireFunction(port, 'ScopeAuthorityPort', 'authorize')
  return port
}

export function assertRawEvidenceReadPort(port) {
  requireFunction(port, 'RawEvidenceReadPort', 'listMarketCandidates')
  return port
}

export function assertAuditPort(port) {
  requireFunction(port, 'AuditPort', 'record')
  return port
}

export function assertObservationStoreFactory(openObservationStore) {
  if (typeof openObservationStore !== 'function') {
    throw new TypeError('openObservationStore factory is required')
  }
  return openObservationStore
}

export function assertObservationStore(store, methods) {
  for (const method of methods) requireFunction(store, 'ObservationStore', method)
  return store
}

/** A refusal the transport maps to an HTTP status; message is safe to show. */
export class MarketRefusal extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'MarketRefusal'
    this.status = status
  }
}

/**
 * Run the authority port and return a trusted scope, or throw a MarketRefusal.
 * A malformed provider answer is a server fault, not a refusal: it must not be
 * readable as "allowed" and must not be mistaken for a clean 403/404.
 */
export async function authorizeScope(scopeAuthority, { actor, businessId, action }) {
  const decision = await scopeAuthority.authorize({ actor, businessId, action })
  if (decision?.allowed === true) {
    const scope = decision.scope
    if (!scope?.tenantId || scope.businessId !== businessId) {
      throw new Error('ScopeAuthorityPort returned a scope that does not match the requested Business')
    }
    return scope
  }
  if (decision?.allowed === false && [403, 404].includes(decision.status) && decision.message) {
    throw new MarketRefusal(decision.status, decision.message)
  }
  throw new Error('ScopeAuthorityPort returned an invalid decision')
}
