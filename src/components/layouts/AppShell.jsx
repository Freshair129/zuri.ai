'use client'

import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import DomainBar from './DomainBar'
import Breadcrumb from './Breadcrumb'
import CommandPalette from './CommandPalette'

export default function AppShell({ children }) {
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen flex-col">
      {/* Row 1 — workspace/scope bar, full width, topmost layer (carries the viewed domain icon). */}
      <Topbar onOpenPalette={() => setPaletteOpen(true)} />
      {/* Row 2 — domain bar, full width horizontal, no longer split by the sidebar. */}
      <DomainBar />
      {/* Row 3 — sidebar (in-flow) + content. Expanding the rail pushes content, never overlays it. */}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* "You are here" strip — scope › domain › page. */}
          <div className="flex h-9 shrink-0 items-center border-b border-[var(--border)] bg-[var(--surface)] px-6 max-md:px-4">
            <Breadcrumb />
          </div>
          <main className="flex-1 overflow-y-auto p-6 max-md:p-4">{children}</main>
          <footer className="flex h-7 items-center gap-3 border-t border-[var(--border)] bg-white px-3 text-[10px] text-[#7B8490]">
            <span style={{ color: 'var(--success)' }}>● local</span>
            <span>SQLite · offline-first</span>
            <span className="ml-auto">zuri-v2</span>
          </footer>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
