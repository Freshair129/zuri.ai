'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { domainForPath } from '@/config/domains'

// Tier 3 (SITEMAP-V2): the active domain's sub-domains, Dashboard pinned first.
// Behaviour matched to V1 (G:\zuri Sidebar.jsx): an 80px icon rail that expands to 256px
// on hover, transition-all duration-500 ease cubic-bezier(0.25,0.8,0.25,1) (no delay),
// labels fade over 300ms, active item is a solid brand pill with a glow, and the
// collapsed rail shows a brand indicator bar on the active item.
export default function Sidebar() {
  const pathname = usePathname()
  const domain = domainForPath(pathname)
  const [hovered, setHovered] = useState(false)
  const expanded = hovered

  return (
    // The rail footprint stays 80px in the grid; the aside overlays content when expanded,
    // so hovering never reflows the page.
    <div
      className="relative w-20 shrink-0 max-md:w-16"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <aside
        className={`nav-glass absolute inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-white/10 shadow-2xl transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${
          expanded ? 'w-64' : 'w-20 max-md:w-16'
        }`}
      >
        {/* Header: domain context (icon + label + "menu") */}
        <Link href={domain.sub[0].path} className="flex h-16 shrink-0 items-center gap-3 px-5" aria-label={`${domain.label} home`}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 font-bold text-[var(--brand)] shadow-inner">
            <domain.icon className="h-5 w-5" aria-hidden />
          </span>
          <span className={`min-w-0 transition-opacity duration-300 ${expanded ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            <span className="block whitespace-nowrap text-base font-bold tracking-tight text-white">{domain.label}</span>
            <span className="mt-0.5 block text-[10px] leading-none text-white/70">menu</span>
          </span>
        </Link>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 [scrollbar-width:none]" aria-label={`${domain.label} sections`}>
          {domain.sub.map((item) => {
            const Icon = item.icon
            const active = pathname === item.path || pathname.startsWith(`${item.path}/`)
            return (
              <Link
                key={item.label}
                href={item.path}
                aria-label={!expanded ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-300 ${
                  active
                    ? 'bg-[var(--brand)] text-[#1A1710] shadow-[0_0_15px_var(--brand-glow)]'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 transition-transform ${active ? 'scale-110' : 'group-hover:scale-110'}`} aria-hidden />
                <span className={`truncate transition-opacity duration-300 ${expanded ? 'font-bold opacity-100' : 'opacity-0'}`}>
                  {item.label}
                </span>
                {active && !expanded && (
                  <span className="absolute -left-3 h-6 w-1.5 rounded-r-full bg-[var(--brand)] shadow-[0_0_10px_var(--brand)]" aria-hidden />
                )}
              </Link>
            )
          })}
        </nav>
      </aside>
    </div>
  )
}
