'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// @req FR-002 — scope selectors + persisted selection
// @tested tests/e2e/smoke.spec.js
// Scope hierarchy: Portfolio → Tenant → Business → Workspace → Project.
// Tenant is derived from the selected Business (tenant = isolation, never a branch).

const ScopeContext = createContext(null)

const STORAGE_KEY = 'zuri-v2-scope'

export function ScopeProvider({ children }) {
  const [data, setData] = useState({
    portfolios: [],
    tenants: [],
    businesses: [],
    workspaces: [],
    projects: [],
    loaded: false,
  })
  const [selection, setSelection] = useState({
    portfolioId: null,
    businessId: null, // implies tenantId
    workspaceId: null,
    projectId: null,
  })

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/scope')
      if (!res.ok) return
      const payload = await res.json()
      setData({ ...payload, loaded: true })
    } catch {
      // offline-first: shell still renders without scope data
    }
  }, [])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setSelection((s) => ({ ...s, ...JSON.parse(saved) }))
    } catch {}
    refresh()
  }, [refresh])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
    } catch {}
  }, [selection])

  const select = useCallback((patch) => {
    setSelection((s) => {
      const next = { ...s, ...patch }
      // Selecting up the hierarchy clears descendants.
      if ('portfolioId' in patch) {
        next.businessId = null
        next.workspaceId = null
        next.projectId = null
      } else if ('businessId' in patch) {
        next.workspaceId = null
        next.projectId = null
      } else if ('workspaceId' in patch) {
        next.projectId = null
      }
      return next
    })
  }, [])

  const value = useMemo(() => {
    const business = data.businesses.find((b) => b.id === selection.businessId) || null
    const tenant = business ? data.tenants.find((t) => t.id === business.tenantId) || null : null
    const workspaces = data.workspaces.filter((w) => {
      if (selection.businessId && w.businessId && w.businessId !== selection.businessId) return false
      if (selection.portfolioId && w.portfolioId && w.portfolioId !== selection.portfolioId) return false
      if (selection.businessId && w.scopeType === 'BUSINESS' && w.businessId !== selection.businessId) return false
      return true
    })
    const projects = data.projects.filter(
      (p) => !selection.workspaceId || p.workspaceId === selection.workspaceId
    )
    return {
      ...data,
      selection,
      select,
      refresh,
      currentPortfolio: data.portfolios.find((p) => p.id === selection.portfolioId) || data.portfolios[0] || null,
      currentBusiness: business,
      currentTenant: tenant,
      currentWorkspace: data.workspaces.find((w) => w.id === selection.workspaceId) || null,
      currentProject: data.projects.find((p) => p.id === selection.projectId) || null,
      scopedWorkspaces: workspaces,
      scopedProjects: projects,
    }
  }, [data, selection, select, refresh])

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

export function useScope() {
  const ctx = useContext(ScopeContext)
  if (!ctx) throw new Error('useScope must be used inside ScopeProvider')
  return ctx
}
