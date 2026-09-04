'use client'

// @req FR-033, FR-039, FR-044 — topbar is chrome with a three-level context bar; Organization opens Business Routing and Business is read-only.
// @spec SDD-012, SDD-018, ADR-011
// @tested tests/unit/topbar-no-dropdown.test.js, tests/unit/scope-view-context.test.js
// @req FR-043 - direct Project owner fills the Business context when a deep link has no saved shell selection.
// @spec ADR-014, SDD-021
// @req FR-046, FR-095 — sign-out control: nothing in the BusinessShell chrome
// called `POST /api/auth/logout` before this, so a signed-in person had no way
// to sign out. `useRouter` returns here for that redirect only — `router.push`
// for Project creation (ADR-036 D1) stays removed; see topbar-no-dropdown.test.js.
// @spec ADR-017, SEC-008
// @tested tests/unit/sign-out.test.js, tests/unit/topbar-no-dropdown.test.js
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { Bell, Command, LogOut, Sparkles, UserRound } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'
import { BASE_CONTEXT_LEVELS, SCOPE_VIEWS } from '@/config/scope-views'
import { performSignOut } from '@/modules/identity/sign-out'

function ViewToggle({ mode, onChange }) {
  return (
    <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5 max-md:hidden" role="group" aria-label="Scope view">
      {Object.values(SCOPE_VIEWS).map((view) => {
        const Icon = view.icon
        const active = view.key === mode
        return (
          <button
            key={view.key}
            type="button"
            onClick={() => onChange(view.key)}
            aria-pressed={active}
            title={`${view.label} view`}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold transition ${
              active ? 'bg-[var(--brand)] text-[#1A1710]' : 'text-white/55 hover:text-white'
            }`}
          >
            <Icon size={12} aria-hidden /> {view.label}
          </button>
        )
      })}
    </div>
  )
}

export default function Topbar({ onOpenPalette }) {
  const scope = useScope()
  const { viewMode, setViewMode, currentPortfolio, currentTenant, currentBusiness } = scope
  const pathname = usePathname()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  // @req FR-046, FR-095 — the redirect to /login always happens, whether the
  // server confirmed the revoke or not (the route's own 503 path still clears
  // the cookie). A failed revoke is surfaced, not swallowed: window.alert is
  // this codebase's existing convention for a client mutation that must report
  // its own failure (see src/app/(pm)/platform/integrations/page.jsx).
  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      const { path, warning } = await performSignOut()
      if (warning) window.alert(warning)
      router.replace(path)
    } finally {
      setSigningOut(false)
    }
  }
  const routeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1]
  const routeProject = scope.projects.find((project) => project.id === routeProjectId) || null
  const routeBusiness = routeProject?.businessId
    ? scope.businesses.find((business) => business.id === routeProject.businessId) || null
    : null
  const routeTenant = routeBusiness
    ? scope.tenants.find((tenant) => tenant.id === routeBusiness.tenantId) || null
    : null
  const contextBySchema = {
    portfolio: currentPortfolio,
    tenant: currentTenant || routeTenant,
    business: currentBusiness || routeBusiness,
  }

  return (
    <header className="nav-glass relative z-50 flex items-center gap-3 border-b border-white/10 px-4 py-2.5 text-white max-md:flex-wrap">
      <div className="flex h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3" aria-label="Zuri">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--brand)] text-[#1A1710]" aria-hidden>
          <Sparkles size={15} />
        </span>
        <span className="text-xs font-extrabold tracking-wide">Zuri</span>
      </div>

      <div className="flex min-w-0 items-center border-l border-white/10 pl-3 max-md:hidden" aria-label="Current workspace, organization, and business">
        {BASE_CONTEXT_LEVELS.map((level, index) => {
          const item = contextBySchema[level.schema]
          const contextContent = (
            <>
              <span className="block text-[9px] leading-none text-white/45">{level.label}</span>
              <span className="block max-w-36 truncate text-xs font-bold text-white/90" title={item?.code}>{item?.name || level.fallback}</span>
            </>
          )
          return (
            <span key={level.schema} className="flex min-w-0 items-center">
              {index > 0 && <span className="mx-2 text-white/25">›</span>}
              {level.schema === 'tenant' ? (
                <Link
                  href="/businesses"
                  aria-label="Select Business from Organization"
                  title="Choose a Business in this Organization"
                  className="group min-w-0 rounded-md px-1 py-0.5 transition hover:bg-white/10"
                >
                  {contextContent}
                </Link>
              ) : (
                <span className="min-w-0">{contextContent}</span>
              )}
            </span>
          )
        })}
      </div>

      <div className="min-w-0 flex-1" />

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-xl border border-white/15 bg-white/10 px-3 text-xs"
          onClick={onOpenPalette}
          aria-label="Open command palette (Ctrl+K)"
        >
          <Command size={13} aria-hidden /> <span className="max-md:hidden">Ctrl K</span>
        </button>
        {/* @req FR-086 — the "New Project" button was removed here on 2026-08-19
            (ADR-036 D1). A global control implies Project creation is
            context-free, when it is scoped to the Business or Space the shell
            has selected; the single copy of the action belongs on the surface
            that shows that scope, and `/projects` already renders it. Before
            this the same action existed twice. */}
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
          <Link href="/profile" aria-label="My profile" className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-[#374151] text-[11px] font-extrabold" title="My profile">
            <UserRound size={16} aria-hidden />
          </Link>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="ออกจากระบบ"
            title="ออกจากระบบ"
          >
            <LogOut size={16} aria-hidden />
          </button>
        </div>
      </div>
    </header>
  )
}
