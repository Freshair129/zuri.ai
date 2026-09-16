'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { moduleForBusinessPath, pathMatches } from '@/modules/project-manager/navigation'

// @req FR-247 — Business destinations stay in the Projects & Work domain and
// are presented as local tabs within the selected live module.
// @req FR-039 — this component is presentation-only and does not decide grants.
// @spec ADR-095, docs/architecture/project-manager-system/22-NAVIGATION-IMPLEMENTATION-BASELINE.md
// @tested tests/unit/project-work-route.test.js
export default function ProjectManagerBusinessNav() {
  const pathname = usePathname()
  const module = moduleForBusinessPath(pathname)

  // Project-local module navigation belongs to ProjectLayout. Keeping this
  // boundary explicit prevents a Business rail from being rendered twice on a
  // Project page and keeps Project authority in BusinessShellGuard/scope.
  if (!module || pathname.startsWith('/projects/')) return null

  const tabs = module.businessTabs || []
  const plannedTabs = module.plannedBusinessTabs || []
  return (
    <nav
      aria-label={`${module.label} Business sections`}
      className="mb-4 flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-1.5"
      data-module-id={module.id}
      data-local-surface-scope="BUSINESS"
    >
      <span className="shrink-0 px-3 py-2 text-xs font-bold text-[var(--text)]">{module.label}</span>
      {tabs.map((tab) => {
        if (!tab.path) {
          return (
            <span
              key={tab.id}
              aria-disabled="true"
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-[var(--muted)] opacity-65"
              data-local-surface-id={tab.id}
            >
              {tab.label}
              <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">Planned</span>
            </span>
          )
        }
        const active = pathname === tab.path || pathMatches(tab.path, pathname)
        return (
          <Link
            key={tab.id}
            href={tab.path}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              active
                ? 'bg-[#eaf0ff] text-[#2f4fe0]'
                : 'text-[var(--muted)] hover:bg-[var(--surface-mid)] hover:text-[var(--text)]'
            }`}
            data-local-surface-id={tab.id}
          >
            {tab.label}
          </Link>
        )
      })}
      {plannedTabs.map((tab) => (
        <span
          key={tab.id}
          aria-disabled="true"
          aria-label={`${tab.label} — Planned — not available yet`}
          className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-[var(--muted)] opacity-65"
          data-local-surface-id={tab.id}
        >
          {tab.label}
          <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">Planned — not available yet</span>
        </span>
      ))}
    </nav>
  )
}
