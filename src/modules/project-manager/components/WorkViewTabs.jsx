'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Network, Columns3, GanttChartSquare } from 'lucide-react'

// Sub-views of the project "Work" tab (Indest: Structure Plan · Board · Schedule).
export default function WorkViewTabs({ projectId }) {
  const pathname = usePathname()
  const views = [
    { key: 'structure', label: 'Structure Plan', icon: Network, href: `/projects/${projectId}/structure` },
    { key: 'board', label: 'Board', icon: Columns3, href: `/projects/${projectId}/board` },
    { key: 'timeline', label: 'Schedule', icon: GanttChartSquare, href: `/projects/${projectId}/timeline` },
  ]
  return (
    <div className="mb-4 inline-flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-mid)] p-1">
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
    </div>
  )
}
