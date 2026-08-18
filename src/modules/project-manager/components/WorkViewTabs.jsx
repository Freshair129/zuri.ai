'use client'

// @req FR-040, FR-068 — Project Work owns the composed Execution Roadmap and
// the existing Structure/Board/Schedule/Dependency sub-views.
// @req FR-006 — the project-scoped Milestones & Gates view is one of them. It
// is the same view and service as the Development → Milestones & Gates entry,
// filtered to one Project, exactly as Schedule and Dependency Map mirror their
// global halves. It had no inbound link from anywhere in the app and was
// reachable only by typing the URL.
// @spec SDD-019, SDD-039, ADR-012, ADR-028
// @tested tests/unit/project-work-route.test.js, tests/unit/project-roadmap-ui.test.js
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Network, Columns3, GanttChartSquare, Share2, Map, Flag } from 'lucide-react'

// Sub-views of the project "Work" tab
// (Execution Roadmap · Structure Plan · Board · Schedule · Milestones · Dependency Map).
//
// Every href here must be rendered by a page that itself renders this bar, or
// the tab becomes a one-way door: the user arrives and the siblings vanish.
// `/timeline` was already such a door before Milestones was added; both now
// mount the bar.
export default function WorkViewTabs({ projectId }) {
  const pathname = usePathname()
  const views = [
    { key: 'roadmap', label: 'Execution Roadmap', icon: Map, href: `/projects/${projectId}/roadmap` },
    { key: 'structure', label: 'Structure Plan', icon: Network, href: `/projects/${projectId}/structure` },
    { key: 'board', label: 'Board', icon: Columns3, href: `/projects/${projectId}/board` },
    { key: 'timeline', label: 'Schedule', icon: GanttChartSquare, href: `/projects/${projectId}/timeline` },
    // "Milestones", not "Milestones & Gates": the Development sidebar is on
    // screen at the same time and already owns that exact label for the
    // Business-wide `/milestones` route. One name for two different routes is
    // ambiguous to a reader and to a screen reader alike — Playwright strict
    // mode is what surfaced the collision. Every other project-scoped label
    // here is already a different word from its Business-wide half for the same
    // reason: Schedule vs Timeline, Dependency Map vs Dependencies. The page
    // heading stays "Milestones & Gates"; only the tab is shortened.
    { key: 'milestones', label: 'Milestones', icon: Flag, href: `/projects/${projectId}/milestones` },
    { key: 'dependencies', label: 'Dependency Map', icon: Share2, href: `/projects/${projectId}/dependencies` },
  ]
  return (
    // A named landmark, like `ProjectTabs`' "Project sections": this is
    // navigation, and naming it is what lets a reader — or a test — tell its
    // links apart from the sidebar's without depending on the labels staying
    // unique forever.
    <nav
      aria-label="Project work views"
      className="mb-4 inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-mid)] p-1"
    >
      {views.map((v) => {
        const Icon = v.icon
        const active = pathname === v.href
        return (
          <Link
            key={v.key}
            href={v.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              active ? 'bg-[var(--surface-card)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            <Icon size={14} aria-hidden /> {v.label}
          </Link>
        )
      })}
    </nav>
  )
}
