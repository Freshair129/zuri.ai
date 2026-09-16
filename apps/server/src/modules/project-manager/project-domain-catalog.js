import { DOMAINS } from '@/config/domains'

// @req FR-251 — Project Execution Domains retain the immutable FR-070 binding
// id while projecting the current display label from the existing navigation
// registry.
// @spec FR-070, ADR-025
// @tested tests/unit/project-domain-read-model.test.js

/**
 * The seven execution-purpose bindings are deliberately separate from
 * `DOMAIN_GROUPS`. The latter is a top-bar presentation grouping and cannot
 * become a Project identity or an authorization grant.
 */
export const PROJECT_DOMAIN_CATALOG = Object.freeze([
  Object.freeze({ domainId: 'DOM-DEVELOPMENT', routeKey: 'projects' }),
  Object.freeze({ domainId: 'DOM-COMMERCE', routeKey: 'commerce' }),
  Object.freeze({ domainId: 'DOM-CRM', routeKey: 'customer' }),
  Object.freeze({ domainId: 'DOM-MARKETING', routeKey: 'growth' }),
  Object.freeze({ domainId: 'DOM-OPERATIONS', routeKey: 'operations' }),
  Object.freeze({ domainId: 'DOM-PEOPLE', routeKey: 'people' }),
  Object.freeze({ domainId: 'DOM-PLATFORM', routeKey: 'platform' }),
])

export const PROJECT_DOMAIN_CATALOG_BY_ID = Object.freeze(
  Object.fromEntries(PROJECT_DOMAIN_CATALOG.map((entry) => [entry.domainId, entry]))
)

const RUNTIME_LABELS_BY_ROUTE_KEY = new Map(
  DOMAINS.map((domain) => [domain.key, domain.label])
)

export const UNKNOWN_PROJECT_DOMAIN_LABEL = 'Unknown domain'

/**
 * Resolve an imported immutable domain id without ever deriving one from a
 * route key, title or label. Unknown ids remain visible as UNMAPPED rows.
 */
export function resolveProjectDomain(domainId) {
  const entry = PROJECT_DOMAIN_CATALOG_BY_ID[domainId]
  const label = entry ? RUNTIME_LABELS_BY_ROUTE_KEY.get(entry.routeKey) : null
  if (!entry || !label) {
    return {
      domainId,
      label: UNKNOWN_PROJECT_DOMAIN_LABEL,
      mappingState: 'UNMAPPED',
      routeKey: entry?.routeKey || null,
    }
  }
  return {
    domainId,
    label,
    mappingState: 'MAPPED',
    routeKey: entry.routeKey,
  }
}
