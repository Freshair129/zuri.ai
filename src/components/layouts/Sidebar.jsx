'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { domainForPath } from '@/config/domains'

// Tier 3 (SITEMAP-V2): the left sidebar shows the ACTIVE domain's sub-domains, with the
// Dashboard pinned first. The active domain is derived from the route, so switching a
// domain in the bar swaps this whole list.
export default function Sidebar() {
  const pathname = usePathname()
  const domain = domainForPath(pathname)

  return (
    <aside className="nav-glass flex h-full w-[210px] flex-col border-r border-white/10 px-3 py-3 max-md:w-[64px]">
      <Link
        href="/overview"
        className="mb-4 flex items-center gap-2 px-1 text-white"
        aria-label="Zuri v2 home"
      >
        <span
          className="grid h-9 w-9 place-items-center rounded-xl font-extrabold shadow-lg"
          style={{ background: 'linear-gradient(135deg,var(--brand-hover),var(--brand),#C6720A)' }}
        >
          Z
        </span>
        <span className="text-sm font-extrabold tracking-tight max-md:hidden">Zuri</span>
      </Link>

      <p className="mb-1 px-2 text-[9px] font-bold uppercase tracking-wider text-[#8A93A0] max-md:hidden">
        {domain.label}
      </p>
      <nav className="flex w-full flex-1 flex-col gap-0.5 overflow-y-auto [scrollbar-width:none]" aria-label={`${domain.label} sections`}>
        {domain.sub.map((item) => {
          const Icon = item.icon
          const active = pathname === item.path || pathname.startsWith(`${item.path}/`)
          return (
            <Link
              key={item.label}
              href={item.path}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
                active ? 'bg-[rgba(232,130,12,0.16)] text-white' : 'text-[#C7CDD6] hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={16} aria-hidden className="shrink-0" />
              <span className="truncate max-md:hidden">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
