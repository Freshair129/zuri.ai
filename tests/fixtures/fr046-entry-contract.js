// @req FR-046 — stable response fixtures for the viewer-scoped entry boundary.
// @spec SDD-024, SEC-008
// @tested tests/unit/fr046-entry-read-model.test.js

export const OWNER_VIEWER = {
  principal: { id: 'person-owner', code: 'PER-OWNER', displayName: 'Owner' },
  role: 'OWNER',
  visibleBusinessIds: ['business-1'],
  visibleDomains: ['projects', 'people'],
  isPlatform: false,
}

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
  viewer: {
    principal: { id: 'person-owner', displayName: 'Owner' },
    role: 'OWNER',
    visibleDomains: ['projects', 'people'],
    isPlatform: false,
  },
  businesses: [{
    id: 'business-1',
    code: 'BUS-001',
    name: 'Business 01',
    tenant: { id: 'tenant-1', code: 'TEN-001', name: 'Tenant 001' },
    portfolio: { id: 'portfolio-1', code: 'PF-001', name: 'Business Group' },
  }],
}
