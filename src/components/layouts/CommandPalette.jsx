'use client'

// @req FR-015 — command palette (Ctrl+K) with keyboard navigation
// @req FR-061 — the route index is built from the `DOMAINS` registry, filtered
// by the same per-Business grant `DomainBar` and `BusinessShellGuard` ask for.
// It used to be built from `modules.projectManager.nav`, so search covered the
// eight Development entries and nothing else: Business Home, all seven Platform
// entries, both HR / People entries and Profile — ten of the eighteen sidebar
// destinations — could not be reached by search at all.
//
// Deriving from the registry rather than a second hand-kept list is the point:
// a sub-domain added to `domains.js` becomes searchable without anyone
// remembering this file. Two consequences the derivation has to handle, because
// a registry entry is not automatically a valid destination:
//
//   1. `soon` domains are reserved navigation slots with no page behind them
//      (`/commerce`, `/customer`, `/growth`, `/growth/campaigns`,
//      `/operations`). `DomainBar` renders them as disabled spans precisely so
//      they never become links; indexing them here would reintroduce the dead
//      links it avoids.
//   2. Platform's Dashboard and Settings intentionally share `/settings`
//      (INTERFACE-INVENTORY §4), so the flattened list contains duplicate
//      paths. They are deduped by path — the key is the path, and two results
//      pointing at one page is noise either way.
//
// @spec SDD-034, SDD-018
// @tested tests/e2e/smoke.spec.js, tests/unit/command-palette-index.test.js

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { DOMAINS, isDomainVisible } from '@/config/domains'
import { EXECUTION_NAV } from '@/config/modules'
import { domainsForBusiness } from '@/modules/identity/viewer-domains'
import { useScope } from '@/context/ScopeContext'
import { useFetch } from '@/modules/project-manager/components/useApi'

// Resource lists that are not domain capabilities and so are not in `DOMAINS`,
// each tagged with the domain the route guard will actually evaluate for it.
// Spaces is the schema `Workspace` list: ADR-008 §D6 and SITEMAP-DOMAIN-NAV §6
// deliberately keep it out of the Development sidebar ("a resource, not a
// Development capability"), which left it with no entry point anywhere. It
// belongs in search as a resource, not in the sidebar as a capability.
// `domainForPath('/workspaces')` falls through to `projects`, and `/profile` is
// special-cased to `platform` by `business-shell-guard.js` — mirrored here so
// search never offers a route the guard is about to refuse.
const RESOURCE_ROUTES = [
  { label: 'Spaces', path: '/workspaces', domainKey: 'projects' },
  { label: 'My Profile', path: '/profile', domainKey: 'platform' },
]

/**
 * Flatten the registry into searchable route entries, dropping reserved slots
 * and duplicate paths. Pure, so the rule is testable without a DOM.
 *
 * @param {string[]|undefined} granted per-Business domain allow-list;
 *   `undefined` means "not resolved yet" and stays unfiltered, matching
 *   `DomainBar` — the guard, not the palette, is what denies a route.
 */
export function buildRouteEntries(granted) {
  const visible = DOMAINS.filter((domain) => !domain.soon && isDomainVisible(domain.key, granted))
  const fromDomains = visible.flatMap((domain) =>
    domain.sub.map((item) => ({ kind: 'Route', label: `${domain.label} · ${item.label}`, path: item.path })),
  )
  const fromResources = RESOURCE_ROUTES
    .filter((route) => isDomainVisible(route.domainKey, granted))
    .map((route) => ({ kind: 'Route', label: route.label, path: route.path }))

  const byPath = new Map()
  for (const entry of [...fromDomains, ...fromResources]) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry)
  }
  return [...byPath.values()]
}

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const router = useRouter()
  const scope = useScope()
  const viewer = useFetch('/api/viewer')
  // Same read as `DomainBar`: the grant for the Business the guard authorized,
  // and unfiltered until the viewer lands rather than fail-closed-to-empty.
  const granted = viewer.data ? domainsForBusiness(viewer.data, scope.selection?.businessId) : undefined

  const entries = useMemo(() => {
    const routes = buildRouteEntries(granted)
    const execs = EXECUTION_NAV.map((e) => ({
      kind: 'Execution',
      label: `${e.label} view`,
      path: `/execution/${e.slug}`,
    }))
    // Search stays inside the active business scope (FR-020).
    const projects = scope.scopedProjects.map((p) => ({
      kind: 'Project',
      label: `${p.code} · ${p.name}`,
      path: `/projects/${p.id}`,
    }))
    const workspaces = scope.scopedWorkspaces.map((w) => ({
      kind: 'Space',
      label: `${w.code} · ${w.name}`,
      path: `/workspaces/${w.id}`,
    }))
    return [...routes, ...execs, ...projects, ...workspaces]
  }, [granted, scope.scopedProjects, scope.scopedWorkspaces])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries.slice(0, 10)
    return entries.filter((e) => e.label.toLowerCase().includes(q)).slice(0, 12)
  }, [entries, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => setCursor(0), [query])

  if (!open) return null

  const go = (entry) => {
    onClose()
    if (entry) router.push(entry.path)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(17,24,39,0.58)] pt-[12vh] backdrop-blur"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-[min(640px,90vw)] overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
          <Search size={15} className="text-muted" aria-hidden />
          <input
            ref={inputRef}
            className="flex-1 text-sm outline-none"
            placeholder="Search routes, projects, spaces…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, results.length - 1))
              else if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
              else if (e.key === 'Enter') go(results[cursor])
              else if (e.key === 'Escape') onClose()
            }}
            aria-label="Command palette search"
          />
          <kbd className="rounded bg-surface-mid px-1.5 py-0.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="p-4 text-center text-xs text-muted">No matches for “{query}”.</p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.path}`}
              type="button"
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs ${
                i === cursor ? 'bg-brand-surface text-brand-dark' : 'hover:bg-surface'
              }`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(r)}
            >
              <span className="truncate font-semibold">{r.label}</span>
              <span className="pill pill-planned ml-2">{r.kind}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
