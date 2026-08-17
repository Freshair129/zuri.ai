// @req FR-046 — stable response fixtures for the viewer-scoped entry boundary.
// @spec SDD-024, SEC-008
// @tested tests/unit/fr046-entry-read-model.test.js
//
// Repaid from docs/.viewer-fixture-baseline.json on 2026-08-17: OWNER_VIEWER
// used to be a hand-built literal carrying `role: 'OWNER'` with no
// `ownedBusinessIds` at all — the exact impossible shape
// .brain/rca/2026-08-16-global-role-is-not-per-business-authority.md documents.
// buildViewerEntry() only reads principal/role/visibleDomains/isPlatform/
// visibleBusinessIds (src/modules/identity/entry-read-model.js), so the extra
// fields the factory now fills in (ownedBusinessIds, domainsByBusinessId) are
// inert here but keep this a shape resolveViewer can really produce.
import { makeViewer } from '../factories/viewer'

export const OWNER_VIEWER = makeViewer({
  principal: { id: 'person-owner', code: 'PER-OWNER', displayName: 'Owner' },
  visibleBusinessIds: ['business-1'],
  ownedBusinessIds: ['business-1'],
  visibleDomains: ['projects', 'people'],
})

export const ENTRY_BUSINESS_ROW = {
  id: 'business-1',
  code: 'BUS-001',
  name: 'Business 01',
  tenant: {
    id: 'tenant-1',
    code: 'TEN-001',
    name: 'Tenant 001',
    portfolio: { id: 'portfolio-1', code: 'PF-001', name: 'Business Group' },
  },
}

export const OWNER_ENTRY_RESPONSE = {
  // Mirrors OWNER_VIEWER's projected fields by reference rather than
  // retyping the role string, so this stays a description of what
  // buildViewerEntry() does to that viewer, not a second, independent
  // viewer-shaped literal.
  viewer: {
    principal: { id: OWNER_VIEWER.principal.id, displayName: OWNER_VIEWER.principal.displayName },
    role: OWNER_VIEWER.role,
    visibleDomains: OWNER_VIEWER.visibleDomains,
    isPlatform: OWNER_VIEWER.isPlatform,
  },
  businesses: [{
    id: 'business-1',
    code: 'BUS-001',
    name: 'Business 01',
    tenant: { id: 'tenant-1', code: 'TEN-001', name: 'Tenant 001' },
    portfolio: { id: 'portfolio-1', code: 'PF-001', name: 'Business Group' },
  }],
}
