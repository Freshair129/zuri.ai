// @req FR-032 — Home presents only the group and business cards granted to the viewer.
// @spec SDD-011, docs/features/FR-032-home-entry.md — viewer grants decide visibility; scope inventory supplies labels.
// @tested tests/unit/home-scope.test.js
import { deriveShell } from '@/lib/shell-mode'

function unique(values) {
  return [...new Set(values)]
}

/**
 * Build the Home choice state from a viewer grant and the read-only scope
 * inventory. No parent scope implicitly grants access to a business.
 */
export function buildHomeScope({ viewer, portfolios = [], tenants = [], businesses = [], selection = {} } = {}) {
  const visibleBusinessIds = new Set(viewer?.visibleBusinessIds || [])
  const visibleBusinesses = businesses.filter((business) => visibleBusinessIds.has(business.id))
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]))
  const visiblePortfolioIds = new Set(
    unique(
      visibleBusinesses
        .map((business) => tenantsById.get(business.tenantId)?.portfolioId)
        .filter(Boolean),
    ),
  )
  const groups = portfolios.filter((portfolio) => visiblePortfolioIds.has(portfolio.id))
  const shell = deriveShell({ portfolios: groups, businesses: visibleBusinesses, selection })
  const selectedGroup = groups.find((group) => group.id === selection.portfolioId) || null
  const activeGroup = selectedGroup || (groups.length === 1 ? groups[0] : null)
  const groupBusinesses = activeGroup
    ? visibleBusinesses.filter((business) => tenantsById.get(business.tenantId)?.portfolioId === activeGroup.id)
    : []

  return {
    groups,
    shell,
    activeGroup,
    businesses: groupBusinesses,
    needsGroupChoice: shell.showPortfolioSelector && !activeGroup,
  }
}
