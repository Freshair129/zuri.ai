import domainState from '../../../../docs/.domain-state.json'

// @req FR-094 — the Platform readiness surface reads one committed generated
// snapshot. It does not recalculate against a partial runtime tree and never
// writes product status from UI.
// @spec docs/domains/project-manager/features/FR-094-domain-feature-readiness-dashboard.md
// @tested tests/unit/product-readiness-read-model.test.js

export function getProductReadinessSnapshot() {
  return domainState
}

export function getProductReadinessDomain(domainName) {
  if (!domainName || !domainState.domains[domainName]) return null
  return {
    domainName,
    domain: domainState.domains[domainName],
    features: domainState.features.filter((feature) => feature.primaryDomain === domainName),
  }
}
