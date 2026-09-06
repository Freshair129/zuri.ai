// @req FR-020 — adaptive shell: the UI shows only the hierarchy levels that
// actually offer a choice, inferred from data (never a user-facing setting).
// @spec docs/features/FR-020-adaptive-shell.md
// @tested tests/unit/shell-mode.test.js, tests/e2e/smoke.spec.js
//
// The schema always stores the full chain (Portfolio → Tenant → Business →
// Workspace → Project). Tenant is an isolation boundary and never appears in
// the shell; Portfolio remains ancestry/reporting context, never the
// operational Overview landing.

export const SHELL_SINGLE = 'SINGLE_BUSINESS'
export const SHELL_MULTI = 'MULTI_BUSINESS'

// @req FR-041 - multi-business without a pick is Business-required, never a group landing.
// @spec ADR-013
// @tested tests/unit/shell-mode.test.js, tests/integration/adaptive-shell.test.js, tests/e2e/fr041-business-first.spec.js

/**
 * Workspaces visible inside a business scope — mirrors the server rule in
 * scope-service.listWorkspacesForScope: own workspaces plus group-level
 * (PORTFOLIO-scoped) ones, which are shared across every business.
 */
export function visibleWorkspaces(workspaces, business) {
  if (!business) return workspaces || []
  return (workspaces || []).filter((w) => w.businessId === business.id || w.scopeType === 'PORTFOLIO')
}

/**
 * Derive the whole shell shape from scope data + the persisted selection.
 *
 * @returns {{mode: string, multiBusiness: boolean, activeBusiness: object|null,
 *   activeBusinessId: string|null, landing: 'BUSINESS_REQUIRED'|'BUSINESS',
 *   showBusinessSwitcher: boolean, showWorkspaceSelector: boolean,
 *   scopedWorkspaces: object[]}}
 */
export function deriveShell({ portfolios = [], businesses = [], workspaces = [], selection = {} } = {}) {
  const multiBusiness = businesses.length >= 2
  const soleBusiness = businesses.length === 1 ? businesses[0] : null
  const picked = businesses.find((b) => b.id === selection.businessId) || null
  // A single-business install is implicitly scoped to that business, so a stale
  // saved selection (or none at all) can never leave the user unscoped.
  const activeBusiness = multiBusiness ? picked : soleBusiness
  const scopedWorkspaces = visibleWorkspaces(workspaces, activeBusiness)

  return {
    mode: multiBusiness ? SHELL_MULTI : SHELL_SINGLE,
    multiBusiness,
    activeBusiness,
    activeBusinessId: activeBusiness ? activeBusiness.id : null,
    // A multi-business viewer without a selection must choose a Business from
    // Home; it never lands on a portfolio/group operational roll-up.
    landing: multiBusiness && !activeBusiness ? 'BUSINESS_REQUIRED' : 'BUSINESS',
    showBusinessSwitcher: multiBusiness,
    showWorkspaceSelector: scopedWorkspaces.length > 1,
    // Same rule one level up: a portfolio picker only exists for an owner who
    // actually holds more than one group. A single-portfolio install (the norm)
    // never sees the word.
    showPortfolioSelector: portfolios.length >= 2,
    scopedWorkspaces,
  }
}
