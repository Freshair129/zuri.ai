'use client'

import Link from 'next/link'
import { usePathname, useParams } from 'next/navigation'

// Project context shell: universal tabs use neutral vocabulary.
const TABS = [
  { label: 'Overview', suffix: '' },
  { label: 'All Work', suffix: '/all-work' },
  { label: 'Timeline', suffix: '/timeline' },
  { label: 'Dependencies', suffix: '/dependencies' },
  { label: 'Milestones & Gates', suffix: '/milestones' },
  { label: 'Repositories', suffix: '/repositories' },
  { label: 'Import', suffix: '/import' },
]

export default function ProjectLayout({ children }) {
  const pathname = usePathname()
  const { projectId } = useParams()
  const base = `/projects/${projectId}`

  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Project views">
        {TABS.map((t) => {
          const href = `${base}${t.suffix}`
          const active = t.suffix === '' ? pathname === base : pathname.startsWith(href)
          return (
            <Link
              key={t.suffix}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`rounded-xl border px-3 py-2 text-[10px] font-extrabold tracking-wide transition ${
                active
                  ? 'border-[#F4C38A] bg-brand-tint text-brand-dark shadow-sm'
                  : 'border-[var(--border)] bg-white text-muted hover:border-[#F4C38A] hover:bg-brand-surface hover:text-brand-dark'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      {children}
    </div>
  )
}
