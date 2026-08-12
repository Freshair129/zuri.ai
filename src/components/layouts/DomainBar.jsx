'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DOMAINS, domainForPath } from '@/config/domains'

// Tier 2 (SITEMAP-V2): the domain bar under the topbar. Picking a domain lands on its
// first sub-domain (always the Dashboard). `soon` domains are visible but disabled —
// they lift from V1 per module at cutover.
export default function DomainBar() {
  const pathname = usePathname()
  const activeKey = domainForPath(pathname).key

  return (
    <nav
      aria-label="Domains"
      className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface-card)] px-3 py-2"
    >
      {DOMAINS.map((d) => {
        const Icon = d.icon
        const isActive = d.key === activeKey
        const cls = `flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
          isActive
            ? 'bg-[#eaf0ff] text-[#2f4fe0]'
            : 'text-[var(--muted)] hover:bg-[var(--surface-mid)] hover:text-[var(--text)]'
        }`
        if (d.soon) {
          return (
            <span key={d.key} className={`${cls} cursor-default opacity-50`} title="Lifts from V1 at cutover">
              <Icon size={15} aria-hidden /> {d.label}
            </span>
          )
        }
        return (
          <Link key={d.key} href={d.sub[0].path} className={cls} aria-current={isActive ? 'page' : undefined}>
            <Icon size={15} aria-hidden /> {d.label}
          </Link>
        )
      })}
    </nav>
  )
}
