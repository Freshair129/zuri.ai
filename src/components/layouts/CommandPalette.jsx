'use client'

// @req FR-015 — command palette (Ctrl+K) with keyboard navigation
// @tested tests/e2e/smoke.spec.js

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { modules, EXECUTION_NAV } from '@/config/modules'
import { useScope } from '@/context/ScopeContext'

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const router = useRouter()
  const scope = useScope()

  const entries = useMemo(() => {
    const routes = modules.projectManager.nav.map((n) => ({
      kind: 'Route',
      label: n.label,
      path: n.path,
    }))
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
  }, [scope.scopedProjects, scope.scopedWorkspaces])

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
