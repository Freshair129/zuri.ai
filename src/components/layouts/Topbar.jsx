'use client'

// @req FR-002, FR-020 — scope selectors, adaptive to how many businesses exist.
// Single business  → static identity, no switcher, workspace hidden unless > 1.
// Many businesses  → Slack-style business switcher in the identity corner.
// Tenant and Portfolio never appear as selectable levels (isolation is backend).
// @tested tests/e2e/smoke.spec.js

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Command, Plus, ChevronDown, Layers, Check, Bell } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'

function ScopeSelect({ label, value, options, onChange, placeholder, grow }) {
  return (
    <label
      className={`min-w-[130px] rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 ${grow ? 'max-w-[320px] flex-1' : ''} max-md:min-w-[110px]`}
    >
      <span className="block text-[8px] uppercase tracking-[0.09em] text-[#9EA8B5]">{label}</span>
      <select
        className="mt-0.5 w-full bg-transparent text-xs text-white outline-none [&>option]:text-ink"
        value={value || ''}
        aria-label={label}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.code} · {o.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function Avatar({ name }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-extrabold text-white"
      style={{ background: 'linear-gradient(135deg,var(--brand-hover),var(--brand),#C6720A)' }}
      aria-hidden
    >
      {String(name || 'Z').trim().charAt(0).toUpperCase()}
    </span>
  )
}

function BusinessSwitcher({ businesses, active, onPick, onAddBusiness }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <button
        type="button"
        className="flex h-11 max-w-[230px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-2.5 text-left"
        aria-label="สลับธุรกิจ"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={active ? active.name : 'ทุกธุรกิจ'} />
        <span className="min-w-0 flex-1">
          <span className="block text-[8px] uppercase tracking-[0.09em] text-[#9EA8B5]">ธุรกิจ</span>
          <span className="block truncate text-xs font-bold text-white">{active ? active.name : 'ทุกธุรกิจ'}</span>
        </span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute left-0 top-[calc(100%+6px)] z-50 w-[250px] rounded-2xl border border-[var(--border)] bg-white p-1.5 shadow-2xl"
            role="menu"
            aria-label="รายการธุรกิจ"
          >
            {businesses.map((b) => (
              <button
                key={b.id}
                type="button"
                role="menuitem"
                aria-label={b.name}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-brand-surface"
                onClick={() => {
                  setOpen(false)
                  onPick(b.id)
                }}
              >
                <Avatar name={b.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold">{b.name}</span>
                  <span className="block text-[9px] text-muted">{b.code}</span>
                </span>
                {active?.id === b.id && <Check size={13} aria-hidden style={{ color: 'var(--brand)' }} />}
              </button>
            ))}
            <div className="my-1 border-t border-[var(--border)]" />
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[11px] font-bold hover:bg-brand-surface"
              onClick={() => {
                setOpen(false)
                onPick(null)
              }}
            >
              <Layers size={14} aria-hidden /> ทุกธุรกิจ
              {!active && <Check size={13} aria-hidden style={{ color: 'var(--brand)' }} />}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[11px] font-bold hover:bg-brand-surface"
              onClick={() => {
                setOpen(false)
                onAddBusiness()
              }}
            >
              <Plus size={14} aria-hidden /> เพิ่มธุรกิจ
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function Topbar({ onOpenPalette }) {
  const scope = useScope()
  const router = useRouter()
  const { selection, select, shell } = scope

  const pickBusiness = (id) => {
    select({ businessId: id })
    // Switching context always lands on that scope's overview — never leaves a
    // stale page from the previous business on screen.
    router.push('/overview')
  }

  return (
    <header className="nav-glass flex items-center gap-3 border-b border-white/10 px-4 py-2.5 text-white max-md:flex-wrap">
      {shell.showBusinessSwitcher ? (
        <BusinessSwitcher
          businesses={scope.businesses}
          active={shell.activeBusiness}
          onPick={pickBusiness}
          onAddBusiness={() => router.push('/settings')}
        />
      ) : (
        <div className="flex h-11 items-center gap-2 pr-1" aria-label="ธุรกิจของคุณ">
          <Avatar name={shell.activeBusiness?.name} />
          <span className="truncate text-xs font-bold">{shell.activeBusiness?.name || 'Zuri v2'}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-wrap gap-2" role="group" aria-label="Scope selectors">
        {shell.showPortfolioSelector && (
          <ScopeSelect
            label="Portfolio"
            value={selection.portfolioId}
            options={scope.portfolios}
            onChange={(v) => select({ portfolioId: v })}
            placeholder="All portfolios"
          />
        )}
        {shell.showWorkspaceSelector && (
          <ScopeSelect
            label="Workspace"
            value={selection.workspaceId}
            options={scope.scopedWorkspaces}
            onChange={(v) => select({ workspaceId: v })}
            placeholder="All workspaces"
          />
        )}
        <ScopeSelect
          label="Project"
          value={selection.projectId}
          options={scope.scopedProjects}
          onChange={(v) => {
            select({ projectId: v })
            if (v) router.push(`/projects/${v}`)
          }}
          placeholder="Select project"
          grow
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 text-xs"
          onClick={onOpenPalette}
          aria-label="Open command palette (Ctrl+K)"
        >
          <Command size={13} aria-hidden /> <span className="max-md:hidden">Ctrl K</span>
        </button>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold shadow-md"
          style={{ background: 'linear-gradient(135deg,var(--brand-hover),var(--brand),#C6720A)' }}
          onClick={() => router.push('/projects/new')}
        >
          <Plus size={14} aria-hidden /> New Project
        </button>

        {/* Profile cluster (row 1, right) — mirrors V1's TH/EN · bell · avatar. */}
        <div className="ml-1 flex items-center gap-2 border-l border-white/10 pl-2">
          <div className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] font-bold tracking-wider max-md:hidden">
            <span style={{ color: 'var(--brand)' }}>TH</span>
            <span className="opacity-20">|</span>
            <span className="opacity-50">EN</span>
          </div>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl text-white/60 transition hover:bg-white/10 hover:text-white"
            aria-label="Notifications"
          >
            <Bell size={16} aria-hidden />
          </button>
          <div
            className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-[#374151] text-[11px] font-extrabold"
            title="Local owner (demo identity)"
          >
            LO
          </div>
        </div>
      </div>
    </header>
  )
}
