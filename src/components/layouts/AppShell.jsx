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
    <div className="grid h-screen grid-cols-[210px_minmax(0,1fr)] max-md:grid-cols-[64px_minmax(0,1fr)]">
      <Sidebar />
      <div className="grid min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_28px]">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} />
        <DomainBar />
        <main className="overflow-y-auto p-6 max-md:p-4">{children}</main>
        <footer className="flex items-center gap-3 border-t border-[var(--border)] bg-white px-3 text-[10px] text-[#7B8490]">
          <span style={{ color: 'var(--success)' }}>● local</span>
          <span>SQLite · offline-first</span>
          <span className="ml-auto">zuri-v2-lab</span>
        </footer>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
