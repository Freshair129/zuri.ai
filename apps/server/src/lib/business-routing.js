// @req FR-044 — Business Routing exposes only Businesses granted by the resolved viewer.
// @spec ADR-015, SDD-022 — Portfolio and Tenant are ancestry labels, never operational shells.
// @tested tests/unit/business-routing.test.js

/**
 * Join the viewer grant with the read-only scope inventory for Business Routing.
 * A missing grant is intentionally an empty set; parent scope never implies access.
 */
export function buildBusinessRouting({ viewer, portfolios = [], tenants = [], businesses = [] } = {}) {
  const visibleBusinessIds = new Set(viewer?.visibleBusinessIds || [])
  const portfoliosById = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio]))
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]))

  return businesses
    .filter((business) => visibleBusinessIds.has(business.id))
    .map((business) => {
      const tenant = tenantsById.get(business.tenantId) || null
      const portfolio = tenant ? portfoliosById.get(tenant.portfolioId) || null : null
      return { business, tenant, portfolio }
    })
}
