'use client'

import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import DomainBar from './DomainBar'
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
      {/* Workspace/scope bar — the topmost layer, full width over the L below. */}
      <Topbar onOpenPalette={() => setPaletteOpen(true)} />
      {/* The L: sidebar (vertical) + domain bar (horizontal), meeting at the domain-name corner. */}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <DomainBar />
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
