// Marketing Insights (S6) — the viewer half of InsightScopeAuthority. Reuses
// the one Business-visibility predicate and the `growth` domain gate that
// every Marketing read already applies; it adds no role and no permission key.
//
// @spec SEC-001, SEC-008, docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md (R-03)
// @tested tests/unit/marketing/insights/insight-scope-authority.test.js

import { seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'

/**
 * Predicate over server-owned bindings. Evaluated on every request, so a
 * revoked grant closes reads immediately; a URL or a cached page carries no
 * authority forward.
 */
export function viewerCanReadBinding(viewer) {
  if (!viewer || typeof viewer !== 'object') throw new Error('viewerCanReadBinding: viewer is required')
  return (binding) => {
    if (!binding?.businessId || !seesBusiness(viewer, binding.businessId)) return false
    try {
      assertDomainVisible(viewer, binding.businessId, 'growth')
      return true
    } catch {
      return false
    }
  }
}
