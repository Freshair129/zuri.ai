'use client'

// @req FR-040 — Project Work owns Structure Plan, Board, Schedule, and Dependency Map.
// @req FR-012, FR-018 — Project Plan Import is a Project resource surface of its
// own (INTERFACE-INVENTORY §3.5, "ProjectResourceShell → Import"), so it gets a
// tab here rather than hiding under Work. Nothing in the application linked to
// `/projects/{id}/import`: the whole paste/Excel/form intake path was reachable
// only by typing the URL, and only the e2e suite ever did.
// @spec SDD-019, ADR-012, BR-009
// @tested tests/unit/project-work-route.test.js
import Link from 'next/link'
import { CircleDot, Flag, Users, ListTree, TriangleAlert, ChartPie, Folder, ClipboardList, Upload } from 'lucide-react'

// Indest-style per-project domain tab bar. Built tabs link; the rest are visible but
// marked "soon" so the shape is complete while the sections land one by one.
const TABS = [
  { key: 'project', label: 'Project', icon: CircleDot, href: (id) => `/projects/${id}` },
  { key: 'inventory', label: 'Inventory', icon: ClipboardList, href: (id) => `/projects/${id}/inventory` },
  { key: 'requirements', label: 'Requirements', icon: Flag, soon: true },
  { key: 'team', label: 'Team', icon: Users, href: (id) => `/projects/${id}/team` },
  { key: 'work', label: 'Work', icon: ListTree, href: (id) => `/projects/${id}/structure` },
  { key: 'risks', label: 'Risks', icon: TriangleAlert, soon: true },
  { key: 'resources', label: 'Resources', icon: ChartPie, soon: true },
  { key: 'files', label: 'Files', icon: Folder, href: (id) => `/projects/${id}/files` },
  { key: 'import', label: 'Import', icon: Upload, href: (id) => `/projects/${id}/import` },
]

export default function ProjectTabs({ projectId, active }) {
  return (
    <nav
      aria-label="Project sections"
      className="mb-4 flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-1.5"
    >
      {TABS.map((t) => {
        const Icon = t.icon
        const isActive = t.key === active
        const cls = `flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
          isActive ? 'bg-[#eaf0ff] text-[#2f4fe0]' : 'text-[var(--muted)] hover:bg-[var(--surface-mid)] hover:text-[var(--text)]'
        }`
        if (t.soon || !t.href) {
          return (
            <span key={t.key} className={`${cls} cursor-default opacity-55`} title="Coming soon">
              <Icon size={15} aria-hidden /> {t.label}
            </span>
          )
        }
        return (
          <Link key={t.key} href={t.href(projectId)} className={cls} aria-current={isActive ? 'page' : undefined}>
            <Icon size={15} aria-hidden /> {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
