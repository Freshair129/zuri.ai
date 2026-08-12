'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, House } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'
import { domainForPath } from '@/config/domains'

// "You are here" trail across the content area: scope (business / roll-up) › domain ›
// sub-domain. Labels follow the active view (ERP shows the company; PM shows the workspace),
// so the crumb reads the same way the switcher above it does.
export default function Breadcrumb() {
  const pathname = usePathname()
  const { view, shell } = useScope()
  const domain = domainForPath(pathname)

  const scopeLabel = shell.activeBusiness?.name || view.allLabel
  // Deepest matching sub-domain wins (longest path), so /projects/x lands on "Projects".
  const sub = [...domain.sub]
    .sort((a, b) => b.path.length - a.path.length)
    .find((s) => pathname === s.path || pathname.startsWith(`${s.path}/`))

  const crumbs = [
    { label: scopeLabel },
    { label: domain.label, href: domain.sub[0].path },
  ]
  if (sub && sub.path !== domain.sub[0].path) crumbs.push({ label: sub.label, href: sub.path })

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
      <House size={13} aria-hidden className="shrink-0" />
      {crumbs.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ChevronRight size={12} aria-hidden className="shrink-0 opacity-50" />}
          {c.href && i < crumbs.length - 1 ? (
            <Link href={c.href} className="truncate transition hover:text-[var(--text)]">
              {c.label}
            </Link>
          ) : (
            <span className={`truncate ${i === crumbs.length - 1 ? 'font-semibold text-[var(--text)]' : ''}`}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
