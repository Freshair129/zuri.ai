'use client'

// @req FR-040, FR-068 — Project Work owns the composed Execution Roadmap and
// the existing Structure/Board/Schedule/Dependency sub-views.
// @req FR-006 — the project-scoped Milestones & Gates view is one of them. It
// is the same view and service as the Development → Milestones & Gates entry,
// filtered to one Project, exactly as Schedule and Dependency Map mirror their
// global halves. It had no inbound link from anywhere in the app and was
// reachable only by typing the URL.
// @req FR-005 — the project-scoped All Work browser is a Work sub-view too:
// the project layout already claimed `/all-work` for the Work tab, but only
// Inventory linked to it, so arriving there dropped every sibling view.
// @spec SDD-019, SDD-039, ADR-012, ADR-028
// @tested tests/unit/project-work-route.test.js, tests/unit/project-roadmap-ui.test.js
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PM_WORK_VIEWS } from '@/modules/project-manager/navigation'

// Sub-views of the project "Work" tab (Execution Roadmap · Structure Plan ·
// Board · Work Items · Schedule · Milestones · Dependency Map).
//
// Every href here must be rendered by a page that itself renders this bar, or
// the tab becomes a one-way door: the user arrives and the siblings vanish.
// `/timeline` was already such a door before Milestones was added; all now
// mount the bar (pinned by route-reachability.test.js).
//
// Icons carry one meaning across the whole nav: ListChecks = All Work,
// GanttChartSquare = Schedule and Flag = Milestones & Gates in both this bar
// and the Development sidebar (same view, two scopes). Structure Plan must NOT
// use Network — that icon is the sidebar's Dependencies entry.
export default function WorkViewTabs({ projectId }) {
  const pathname = usePathname()
  const views = PM_WORK_VIEWS.map((view) => ({
    ...view,
    href: `/projects/${projectId}${view.suffix}`,
  }))
  return (
    // A named landmark, like `ProjectTabs`' "Project sections": this is
    // navigation, and naming it is what lets a reader — or a test — tell its
    // links apart from the sidebar's without depending on the labels staying
    // unique forever.
    //
    // `max-w-full` + `overflow-x-auto` because the bar is seven tabs wide since
    // All Work joined it: without them the row pushes the page into a
    // horizontal scroll, which the mobile e2e check forbids outright.
    <nav
      aria-label="Project work views"
      className="mb-4 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-mid)] p-1"
    >
      {views.map((v) => {
        const Icon = v.icon
        const active = pathname === v.href
        return (
          <Link
            key={v.key}
            href={v.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
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
