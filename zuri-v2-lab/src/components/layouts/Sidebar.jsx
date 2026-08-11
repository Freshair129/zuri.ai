'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { modules } from '@/config/modules'

export default function Sidebar() {
  const pathname = usePathname()
  const nav = modules.projectManager.nav

  return (
    <aside className="nav-glass flex h-full w-[86px] flex-col items-center border-r border-white/10 px-2 py-3 max-md:w-[64px]">
      <Link
        href="/overview"
        className="mb-4 grid h-12 w-12 place-items-center rounded-2xl font-extrabold text-white shadow-lg"
        style={{ background: 'linear-gradient(135deg,var(--brand-hover),var(--brand),#C6720A)' }}
        aria-label="Zuri v2 home"
      >
        Z
      </Link>
      <nav className="flex w-full flex-1 flex-col gap-1 overflow-y-auto [scrollbar-width:none]" aria-label="Modules">
        {nav.map((item) => {
          const Icon = item.icon
          const active =
            pathname === item.path || (item.path !== '/overview' && pathname.startsWith(item.path))
          return (
            <Link
              key={item.path}
              href={item.path}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-[54px] flex-col items-center justify-center gap-[3px] rounded-2xl px-1 py-2 transition ${
                active ? 'bg-[rgba(232,130,12,0.13)] text-white' : 'text-[#C7CDD6] hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={17} aria-hidden />
              <span className="max-w-[70px] text-center text-[9px] font-bold max-md:hidden">{item.label}</span>
              {active && (
                <span className="absolute bottom-1 h-1 w-6 rounded-full" style={{ background: 'var(--brand)' }} />
              )}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
