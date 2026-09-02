// The scoped-provider double for rendering client components outside Next's
// app router. It builds the SAME value object ScopeProvider builds — `shell`
// from the real deriveShell, `currentBusiness`, `scopedWorkspaces`,
// `selection`, … — from an inventory the test hands it, so a component that
// reads a field the real provider never exposes fails here the way it fails in
// the browser. (The three SoT Pipeline pages read a top-level `businessId`
// that does not exist — D1-shell-domain-layers-01 — and no source-text test
// could see it.)
//
// tests/unit/sot-pipeline-scope-render.test.js pins this double's key set
// against the real provider, so the two cannot drift apart silently.
import { createContext, createElement, useContext } from 'react'
import { deriveShell } from '@/lib/shell-mode'
import { resolveView, DEFAULT_VIEW } from '@/config/scope-views'

export const EMPTY_INVENTORY = Object.freeze({
  portfolios: [],
  tenants: [],
  businesses: [],
  workspaces: [],
  projects: [],
})

/** Mirror of the value ScopeProvider derives from its data + selection state. */
export function buildScopeValue({
  inventory = {},
  selection = {},
  viewMode = DEFAULT_VIEW,
  select = () => {},
  refresh = async () => {},
  setViewMode = () => {},
} = {}) {
  const data = { ...EMPTY_INVENTORY, ...inventory, loaded: true }
  const sel = { portfolioId: null, businessId: null, workspaceId: null, projectId: null, ...selection }
  const shell = deriveShell({
    portfolios: data.portfolios,
    businesses: data.businesses,
    workspaces: data.workspaces,
    selection: sel,
  })
  const business = shell.activeBusiness
  const tenant = business ? data.tenants.find((t) => t.id === business.tenantId) || null : null
  const portfolioId = sel.portfolioId || tenant?.portfolioId || null
  const portfolio = data.portfolios.find((item) => item.id === portfolioId)
    || (data.portfolios.length === 1 ? data.portfolios[0] : null)
  const workspaces = shell.scopedWorkspaces
  const projects = data.projects.filter((p) => {
    if (sel.workspaceId) return p.workspaceId === sel.workspaceId
    if (shell.activeBusinessId) return p.businessId !== undefined
      ? p.businessId === shell.activeBusinessId
      : workspaces.some((w) => w.id === p.workspaceId)
    return true
  })
  return {
    ...data,
    selection: sel,
    select,
    refresh,
    shell,
    viewMode,
    setViewMode,
    view: resolveView(viewMode),
    currentPortfolio: portfolio,
    currentBusiness: business,
    currentTenant: tenant,
    currentWorkspace: data.workspaces.find((w) => w.id === sel.workspaceId) || null,
    currentProject: data.projects.find((p) => p.id === sel.projectId) || null,
    scopedWorkspaces: workspaces,
    scopedProjects: projects,
  }
}

/**
 * A drop-in module shape for `vi.mock('@/context/ScopeContext', …)`:
 * `<ScopeProvider inventory selection>` provides, `useScope()` reads.
 */
export function createScopeContextDouble() {
  const ScopeContext = createContext(null)
  function ScopeProvider({ children, ...props }) {
    return createElement(ScopeContext.Provider, { value: buildScopeValue(props) }, children)
  }
  function useScope() {
    const ctx = useContext(ScopeContext)
    if (!ctx) throw new Error('useScope must be used inside ScopeProvider')
    return ctx
  }
  return { ScopeProvider, useScope }
}

/** Two Businesses under one Tenant, each with a Space, plus a group-level Space. */
export function sampleInventory() {
  return {
    portfolios: [{ id: 'pf-1', code: 'PF-1', name: 'Group' }],
    tenants: [{ id: 'ten-1', code: 'TNT-1', name: 'Tenant One', portfolioId: 'pf-1' }],
    businesses: [
      { id: 'biz-1', code: 'BUS-1', name: 'Alpha Co', tenantId: 'ten-1' },
      { id: 'biz-2', code: 'BUS-2', name: 'Beta Co', tenantId: 'ten-1' },
    ],
    workspaces: [
      { id: 'ws-1', code: 'WS-1', name: 'Alpha Space', businessId: 'biz-1', scopeType: 'BUSINESS' },
      { id: 'ws-2', code: 'WS-2', name: 'Beta Space', businessId: 'biz-2', scopeType: 'BUSINESS' },
      { id: 'ws-g', code: 'WS-G', name: 'Group Space', businessId: null, portfolioId: 'pf-1', scopeType: 'PORTFOLIO' },
    ],
    projects: [],
  }
}
