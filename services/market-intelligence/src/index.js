// Public surface of the Market Intelligence service core (M1). Composition roots
// import from here, never from individual files, so the core can reorganise
// without breaking consumers.
// @req FR-092
// @spec SDD-049, ADR-038
// @tested services/market-intelligence/test/ports.test.js

export * from './domain/market-observation.js'
export {
  buildMarketObservationLineageKey,
  translateRawRecordToMarketObservation,
} from './core/translate-raw-record.js'
export { extractGenericMarketCandidate } from './core/generic-candidate-extractor.js'
export { createGksMarketIdentityResolver as createKnowledgeIdentityResolver } from './core/knowledge-identity-resolver.js'
export * from './core/observation-feed.js'
export * from './core/translation-run.js'
export * from './ports/contracts.js'
