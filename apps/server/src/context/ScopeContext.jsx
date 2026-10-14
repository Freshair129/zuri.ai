'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { deriveShell } from '@/lib/shell-mode'
import { resolveView, DEFAULT_VIEW } from '@/config/scope-views'

// @req FR-002, FR-020, FR-039 — persisted data selection with a Business-bound shell.
// @spec SDD-018, ADR-011
// @tested tests/e2e/smoke.spec.js, tests/unit/scope-view-context.test.js
// @req FR-046 — entry surfaces never prefetch the broad compatibility scope inventory.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js, tests/e2e/fr046-entry-contract.spec.js
// Scope hierarchy: Portfolio → Tenant → Business → Workspace → Project.
// Tenant is derived from the selected Business (tenant = isolation, never a branch).
// `viewMode` (erp | pm) is a presentation lens over the same hierarchy — see scope-views.js.

const ScopeContext = createContext(null)

const STORAGE_KEY = 'zuri-v2-scope'
const VIEW_KEY = 'zuri-v2-view'
const ENTRY_PATHS = new Set(['/', '/login', '/businesses'])

export function ScopeProvider({ children }) {
  const pathname = usePathname()
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
  const [viewMode, setViewMode] = useState(DEFAULT_VIEW)
  const scopeRequestId = useRef(0)
  const activeScopeRequest = useRef(null)

  const loadScope = useCallback(({ force = false, settleLoadedOnFailure = false } = {}) => {
    if (!force && activeScopeRequest.current) return activeScopeRequest.current.promise

    const requestId = ++scopeRequestId.current
    const promise = (async () => {
      try {
        const res = force
          ? await fetch('/api/scope', { cache: 'no-store' })
          : await fetch('/api/scope')
        if (!res.ok) throw new Error('Scope refresh failed')
        const payload = await res.json()
        if (!Array.isArray(payload?.businesses)) throw new Error('Scope response is invalid')

        if (requestId === scopeRequestId.current) setData({ ...payload, loaded: true })
        return { ok: true, payload }
      } catch {
        if (requestId === scopeRequestId.current && settleLoadedOnFailure) {
          setData((current) => ({ ...current, loaded: true }))
        }
        return { ok: false, payload: null }
      }
    })()

    activeScopeRequest.current = { requestId, promise }
    void promise.then(() => {
      if (activeScopeRequest.current?.requestId === requestId) activeScopeRequest.current = null
    })
    return promise
  }, [])

  const refresh = useCallback(async () => {
    await loadScope()
  }, [loadScope])

  const refreshForBusinessEntry = useCallback(async (businessId) => {
    // Business Routing loads from the narrow /api/entry model. Read the broad
    // scope only after explicit Business selection, and keep the shell waiting
    // while that fresh inventory is loading.
    setData((current) => ({ ...current, loaded: false }))
    const result = await loadScope({ force: true, settleLoadedOnFailure: true })
    // The routing page remains open on failure so a later explicit click can retry.
    return result.ok && result.payload.businesses.some((business) => business?.id === businessId)
  }, [loadScope])

  const [restored, setRestored] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setSelection((s) => ({ ...s, ...JSON.parse(saved) }))
      const savedView = localStorage.getItem(VIEW_KEY)
      if (savedView) setViewMode(savedView)
    } catch {}
    setRestored(true)
    if (ENTRY_PATHS.has(pathname)) return
    refresh()
  }, [pathname, refresh])

  useEffect(() => {
    // Never write before the saved selection has been read back, or the empty
    // initial state would erase it (B2: the shell must remember the business).
    if (!restored) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
      localStorage.setItem(VIEW_KEY, viewMode)
    } catch {}
  }, [selection, viewMode, restored])

  const select = useCallback((patch) => {
    setSelection((s) => {
      const next = { ...s, ...patch }
      // Selecting up the hierarchy clears descendants.
      if ('portfolioId' in patch && !('businessId' in patch)) {
        next.businessId = null
        next.workspaceId = null
        next.projectId = null
      } else if ('businessId' in patch && !('workspaceId' in patch)) {
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
    // Portfolio is the PM lens's top Workspace. Prefer the explicit selection,
    // otherwise inherit it from the selected business. Never silently pick the
    // first group when several are visible.
    const portfolioId = selection.portfolioId || tenant?.portfolioId || null
    const portfolio = data.portfolios.find((item) => item.id === portfolioId)
      || (data.portfolios.length === 1 ? data.portfolios[0] : null)
    const workspaces = shell.scopedWorkspaces
    // @req FR-043 - Business scope uses direct Project ownership; Workspace
    // remains a compatibility fallback while old snapshots are backfilled.
    const projects = data.projects.filter((p) => {
      if (selection.workspaceId) return p.workspaceId === selection.workspaceId
      if (shell.activeBusinessId) return p.businessId !== undefined
        ? p.businessId === shell.activeBusinessId
        : workspaces.some((w) => w.id === p.workspaceId)
      return true
    })
    return {
      ...data,
      selection,
      select,
      refresh,
      refreshForBusinessEntry,
      shell,
      viewMode,
      setViewMode,
      view: resolveView(viewMode),
      currentPortfolio: portfolio,
      currentBusiness: business,
      currentTenant: tenant,
      currentWorkspace: data.workspaces.find((w) => w.id === selection.workspaceId) || null,
      currentProject: data.projects.find((p) => p.id === selection.projectId) || null,
      scopedWorkspaces: workspaces,
      scopedProjects: projects,
    }
  }, [data, selection, select, refresh, refreshForBusinessEntry, viewMode])

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>
}

export function useScope() {
  const ctx = useContext(ScopeContext)
  if (!ctx) throw new Error('useScope must be used inside ScopeProvider')
  return ctx
}
