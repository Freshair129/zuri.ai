'use client'

import { useRouter } from 'next/navigation'
import { Command, Plus } from 'lucide-react'
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

export default function Topbar({ onOpenPalette }) {
  const scope = useScope()
  const router = useRouter()
  const { selection, select } = scope

  return (
    <header className="nav-glass flex items-center gap-3 border-b border-white/10 px-4 py-2.5 text-white max-md:flex-wrap">
      <div className="flex min-w-0 flex-1 flex-wrap gap-2" role="group" aria-label="Scope selectors">
        <ScopeSelect
          label="Portfolio"
          value={selection.portfolioId}
          options={scope.portfolios}
          onChange={(v) => select({ portfolioId: v })}
          placeholder="All portfolios"
        />
        <ScopeSelect
          label="Business"
          value={selection.businessId}
          options={scope.businesses}
          onChange={(v) => select({ businessId: v })}
          placeholder="All businesses"
        />
        <ScopeSelect
          label="Workspace"
          value={selection.workspaceId}
          options={scope.scopedWorkspaces}
          onChange={(v) => select({ workspaceId: v })}
          placeholder="All workspaces"
        />
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
          onClick={() => router.push('/projects?new=1')}
        >
          <Plus size={14} aria-hidden /> New Project
        </button>
        <div
          className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-[#374151] text-[11px] font-extrabold"
          title="Local owner (demo identity)"
        >
          LO
        </div>
      </div>
    </header>
  )
}
