import domainState from '../../../../docs/.domain-state.json'
import { isDomainVisible } from '@/config/domains'

// @req FR-124 — the Platform readiness surface reads one committed generated
// snapshot. It does not recalculate against a partial runtime tree and never
// writes product status from UI.
// @spec docs/domains/project-manager/features/FR-124-product-readiness-dashboard.md, FR-060, SEC-008
// @tested tests/unit/fr124-product-readiness-read-model.test.js
//
// The snapshot is repository governance metadata — requirement ids, their
// declared status, and the source and test paths that evidence them. It contains
// no Tenant, Business, Project, Person or Customer data, and this module issues
// no query and takes no request, so there is no scope for a caller to widen: the
// same bytes are returned to every viewer. The authorization question this
// surface does have to answer is therefore not "which rows may you see" but
// "may you see the engineering interior at all", and that is
// `resolveProductReadinessDecision` below.

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

/**
 * May this viewer open Product Readiness?
 *
 * @req FR-124 — resolved on the server, before the snapshot is rendered.
 *
 * Every other page under `src/app/(pm)/**` is a client component that fetches
 * through a viewer-resolving API, so `BusinessShellGuard` — which is a *client*
 * guard — has never been the only thing standing between an unauthenticated
 * browser and real data. This surface is the first server-rendered page in that
 * group that carries its payload inline, so the client guard alone would ship
 * the whole snapshot in the RSC payload and only then decide not to display it.
 * Hence a server-side decision, in the shape `resolvePlatformControlDecision`
 * already established for FR-105's comparable static projection.
 *
 * The rule itself is not new: `isDomainVisible` is FR-060's single predicate,
 * the same one the domain bar and the route guard use, so Platform visibility
 * means here exactly what it means everywhere else.
 */
export function resolveProductReadinessDecision({ viewer = null, viewerError = null } = {}) {
  if (viewerError || !viewer) return { state: 'AUTH_REQUIRED', redirect: '/login' }
  if (!isDomainVisible('platform', viewer.visibleDomains)) return { state: 'FORBIDDEN' }
  return { state: 'READY' }
}
