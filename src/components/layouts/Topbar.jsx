'use client'

// @req FR-002, FR-020 — scope selectors, adaptive to how many businesses exist.
// Single business  → static identity, no switcher, workspace hidden unless > 1.
// Many businesses  → Slack-style switcher in the identity corner.
// Tenant and Portfolio never appear as selectable levels (isolation is backend).
// The whole row is driven by the active scope VIEW (ERP | PM) — same selection state,
// different labels + a different hero switcher. See src/config/scope-views.js.
// @tested tests/e2e/smoke.spec.js

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Command, Plus, ChevronDown, Layers, Check, Bell } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'
import { domainForPath } from '@/config/domains'
import { SCOPE_VIEWS } from '@/config/scope-views'

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

// Slack-style primary switcher — used for whichever level the active view marks `hero`
// (Business in ERP, the Workspace/Portfolio in PM). `onPick(null)` selects the "all" roll-up.
function HeroSwitcher({ eyebrow, items, activeId, allLabel, addLabel, onPick, onAdd }) {
  const [open, setOpen] = useState(false)
  const active = items.find((i) => i.id === activeId) || null

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
        aria-label={`สลับ${eyebrow}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={active ? active.name : allLabel} />
        <span className="min-w-0 flex-1">
          <span className="block text-[8px] uppercase tracking-[0.09em] text-[#9EA8B5]">{eyebrow}</span>
          <span className="block truncate text-xs font-bold text-white">{active ? active.name : allLabel}</span>
        </span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute left-0 top-[calc(100%+6px)] z-50 w-[250px] rounded-2xl border border-[var(--border)] bg-white p-1.5 shadow-2xl"
            role="menu"
            aria-label={`รายการ${eyebrow}`}
          >
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                aria-label={it.name}
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-brand-surface"
                onClick={() => {
                  setOpen(false)
                  onPick(it.id)
                }}
              >
                <Avatar name={it.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold">{it.name}</span>
                  <span className="block text-[9px] text-muted">{it.code}</span>
                </span>
                {activeId === it.id && <Check size={13} aria-hidden style={{ color: 'var(--brand)' }} />}
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
              <Layers size={14} aria-hidden /> {allLabel}
              {!activeId && <Check size={13} aria-hidden style={{ color: 'var(--brand)' }} />}
            </button>
            {onAdd && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[11px] font-bold hover:bg-brand-surface"
                onClick={() => {
                  setOpen(false)
                  onAdd()
                }}
              >
                <Plus size={14} aria-hidden /> {addLabel}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ERP ⇄ PM lens toggle — flips labels + which level is the hero switcher.
function ViewToggle({ mode, onChange }) {
  return (
    <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5 max-md:hidden" role="group" aria-label="Scope view">
      {Object.values(SCOPE_VIEWS).map((v) => {
        const Icon = v.icon
        const active = v.key === mode
        return (
          <button
            key={v.key}
            type="button"
            onClick={() => onChange(v.key)}
            aria-pressed={active}
            title={`${v.label} view`}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition ${
              active ? 'bg-[var(--brand)] text-[#1A1710]' : 'text-white/55 hover:text-white'
            }`}
          >
            <Icon size={12} aria-hidden /> {v.label}
          </button>
        )
      })}
    </div>
  )
}

export default function Topbar({ onOpenPalette }) {
  const scope = useScope()
  const router = useRouter()
  const pathname = usePathname()
  const domain = domainForPath(pathname)
  const DomainIcon = domain.icon
  const { selection, select, view, viewMode, setViewMode } = scope

  // Options + current value + change handler, keyed by the schema entity each level maps to.
  const optionsFor = {
    portfolio: scope.portfolios,
    business: scope.businesses,
    workspace: scope.scopedWorkspaces,
    project: scope.scopedProjects,
  }
  const valueFor = {
    portfolio: selection.portfolioId,
    business: selection.businessId,
    workspace: selection.workspaceId,
    project: selection.projectId,
  }
  const pick = (schema, id) => {
    if (schema === 'portfolio') {
      select({ portfolioId: id })
      router.push('/overview')
    } else if (schema === 'business') {
      select({ businessId: id })
      router.push('/overview')
    } else if (schema === 'workspace') {
      select({ workspaceId: id })
    } else if (schema === 'project') {
      select({ projectId: id })
      if (id) router.push(`/projects/${id}`)
    }
  }
  // A level is worth showing only when it has something to choose (project always shows).
  const visible = {
    portfolio: scope.portfolios.length > 1,
    business: scope.businesses.length > 0,
    workspace: scope.scopedWorkspaces.length > 0,
    project: true,
  }

  const heroLevel = view.levels.find((l) => l.hero) || view.levels.find((l) => l.schema === 'business')
  const restLevels = view.levels.filter((l) => l !== heroLevel && visible[l.schema])

  return (
    <header className="nav-glass relative z-50 flex items-center gap-3 border-b border-white/10 px-4 py-2.5 text-white max-md:flex-wrap">
      <HeroSwitcher
        eyebrow={heroLevel.label}
        items={optionsFor[heroLevel.schema]}
        activeId={valueFor[heroLevel.schema]}
        allLabel={view.allLabel}
        addLabel={view.addLabel}
        onPick={(id) => pick(heroLevel.schema, id)}
        onAdd={heroLevel.schema === 'business' ? () => router.push('/settings') : undefined}
      />

      {/* Viewed-domain context — the icon of the domain currently on screen. */}
      <div className="flex items-center gap-2 border-l border-white/10 pl-3 max-md:hidden" aria-label={`Viewing ${domain.label}`}>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-[var(--brand)] shadow-inner">
          <DomainIcon size={16} aria-hidden />
        </span>
        <span className="whitespace-nowrap text-xs font-bold text-white/90">{domain.label}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap gap-2" role="group" aria-label="Scope selectors">
        {restLevels.map((lvl) => (
          <ScopeSelect
            key={lvl.schema}
            label={lvl.label}
            value={valueFor[lvl.schema]}
            options={optionsFor[lvl.schema]}
            onChange={(v) => pick(lvl.schema, v)}
            placeholder={lvl.placeholder}
            grow={lvl.schema === 'project'}
          />
        ))}
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

        {/* Profile cluster (row 1, right) — view toggle · TH/EN · bell · avatar. */}
        <div className="ml-1 flex items-center gap-2 border-l border-white/10 pl-2">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
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
