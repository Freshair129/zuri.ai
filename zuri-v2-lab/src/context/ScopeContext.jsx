'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { deriveShell } from '@/lib/shell-mode'

// @req FR-002, FR-020 — scope selectors + persisted selection + adaptive shell
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

  const [restored, setRestored] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setSelection((s) => ({ ...s, ...JSON.parse(saved) }))
    } catch {}
    setRestored(true)
    refresh()
  }, [refresh])

  useEffect(() => {
    // Never write before the saved selection has been read back, or the empty
    // initial state would erase it (B2: the shell must remember the business).
    if (!restored) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
    } catch {}
  }, [selection, restored])

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
    // Shell shape (single vs multi business) is derived from the data itself.
    const shell = deriveShell({
      portfolios: data.portfolios,
      businesses: data.businesses,
      workspaces: data.workspaces,
      selection,
    })
    const business = shell.activeBusiness
    const tenant = business ? data.tenants.find((t) => t.id === business.tenantId) || null : null
    const workspaces = shell.scopedWorkspaces
    const projects = data.projects.filter((p) => {
      if (selection.workspaceId) return p.workspaceId === selection.workspaceId
      if (shell.activeBusinessId) return workspaces.some((w) => w.id === p.workspaceId)
      return true
    })
    return {
      ...data,
      selection,
      select,
      refresh,
      shell,
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
