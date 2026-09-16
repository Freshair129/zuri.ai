'use client'

import { Fragment, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { sidebarDomainForPath } from '@/config/domains'
import { useScope } from '@/context/ScopeContext'
import {
  PM_MODULES,
  authorizedProjectFromScope,
  moduleForBusinessPath,
  moduleForProjectPath,
  projectIdFromPath,
  projectPath,
} from '@/modules/project-manager/navigation'

// @req FR-039 — sidebar exposes the active Business domain's sub-domains.
// @spec SDD-018, ADR-011, SITEMAP-V2-DOMAIN-NAV §3
// @tested tests/unit/sidebar-visible-subdomains.test.js
// Tier 3 (SITEMAP-V2): the active domain's labelled sub-domains. Desktop keeps this
// in-flow menu open; the compact icon-only form is reserved for mobile.
// @req FR-167 — for a domain that belongs to a group this lists the WHOLE group
// (ADR-069 D1): each sibling's label as a section header over its own pages, so
// a child reached from the bar can reach the other three. The section header is
// the same `group` field this file already renders, so the group costs no new
// rendering concept. `domainForPath` is untouched and still answers with the
// leaf, which is what the route guard asks about.
export default function Sidebar() {
  const pathname = usePathname()
  // @req FR-169 — capability-gated slots (Warehouse) drop out of the group's
  // own sidebar list the same way they drop out of the bar, from the same
  // Business object, so the two can never disagree about which children exist.
  const scope = useScope()
  const domain = sidebarDomainForPath(pathname, scope.shell.activeBusiness)

  if (domain.key === 'projects') {
    return <ProjectManagerSidebar pathname={pathname} scope={scope} domain={domain} />
  }

  return (
    <aside
      className="nav-glass relative z-30 flex w-64 shrink-0 flex-col overflow-hidden border-r border-white/10 shadow-2xl max-md:w-16"
    >
      <>
        {/* Header: domain context (icon + label + "menu") */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-5 max-md:px-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 font-bold text-[var(--brand)] shadow-inner">
            <domain.icon className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 max-md:pointer-events-none max-md:opacity-0">
            <span className="block whitespace-nowrap text-base font-bold tracking-tight text-white">{domain.label}</span>
            <span className="mt-0.5 block text-[10px] leading-none text-white/70">menu</span>
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 [scrollbar-width:none]" aria-label={`${domain.label} sections`}>
          {domain.sub.map((item, index) => {
            const Icon = item.icon
            // @req FR-159 — Marketing's root dashboard must not select itself on Strategy.
            const active = pathname === item.path || (!item.exact && pathname.startsWith(`${item.path}/`))
            // A header marks where a scope group starts. Several Development
            // entries share names with a Project's own Work views on purpose
            // (the global half of the same view) — the header is what tells the
            // reader these operate across all projects, not inside the open one.
            const startsGroup = item.group && item.group !== domain.sub[index - 1]?.group
            return (
              <Fragment key={item.label}>
                {startsGroup && (
                  <p className="px-3 pb-1 pt-4 text-[9px] font-bold uppercase tracking-[0.14em] text-white/40 max-md:hidden">
                    {item.group}
                  </p>
                )}
              {item.soon ? (
                /* @req FR-167 — a reserved sibling is listed and disabled, never
                   linked: it has no page, and a link that 404s is worse than a
                   slot that says it is not built yet (ADR-069 D3). */
                <span
                  aria-label={item.label}
                  aria-disabled="true"
                  title="Reserved — not available yet"
                  className="group relative flex cursor-default items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-white/25 max-md:justify-center"
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="truncate font-bold max-md:pointer-events-none max-md:opacity-0">
                    {item.label}
                  </span>
                </span>
              ) : (
              <Link
                href={item.path}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-300 max-md:justify-center ${
                  active
                    ? 'bg-[var(--brand)] text-[#1A1710] shadow-[0_0_15px_var(--brand-glow)]'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 transition-transform ${active ? 'scale-110' : 'group-hover:scale-110'}`} aria-hidden />
                <span className="truncate font-bold max-md:pointer-events-none max-md:opacity-0">
                  {item.label}
                </span>
              </Link>
              )}
              </Fragment>
            )
          })}
        </nav>
      </>
    </aside>
  )
}

function ProjectManagerSidebar({ pathname, scope, domain }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openPlannedId, setOpenPlannedId] = useState(null)
  const mobileTriggerRef = useRef(null)
  const plannedTriggerRefs = useRef({})
  const panelPrefix = useId()
  const projectId = projectIdFromPath(pathname)
  const authorizedProject = authorizedProjectFromScope(scope, projectId)
  const projectContext = Boolean(projectId && authorizedProject)
  const activeModule = projectContext
    ? moduleForProjectPath(pathname, projectId)
    : moduleForBusinessPath(pathname)

  useEffect(() => {
    if (!mobileOpen && !openPlannedId) return undefined
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (openPlannedId) {
        const trigger = plannedTriggerRefs.current[openPlannedId]
        setOpenPlannedId(null)
        trigger?.focus()
        return
      }
      setMobileOpen(false)
      mobileTriggerRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [mobileOpen, openPlannedId])

  const navigate = () => setMobileOpen(false)
  const clearProjectContext = () => {
    scope.select?.({ projectId: null })
    navigate()
  }
  const moduleHref = (module) => {
    if (projectContext && module.projectSuffix != null) return projectPath(projectId, module.projectSuffix)
    return module.businessPath
  }

  return (
    <aside className="nav-glass relative z-30 flex w-64 shrink-0 flex-col overflow-hidden border-r border-white/10 shadow-2xl max-md:w-full">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-5 max-md:px-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 font-bold text-[var(--brand)] shadow-inner">
          <domain.icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block whitespace-nowrap text-base font-bold tracking-tight text-white">{domain.label}</span>
          <span className="mt-0.5 block text-[10px] leading-none text-white/70">{projectContext ? 'Project modules' : 'Business modules'}</span>
        </div>
        <button
          ref={mobileTriggerRef}
          type="button"
          className="hidden shrink-0 rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white max-md:block"
          aria-expanded={mobileOpen}
          aria-controls={`${panelPrefix}-modules`}
          aria-label="Toggle Projects & Work navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <ChevronDown size={18} aria-hidden className={`transition ${mobileOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <nav
        id={`${panelPrefix}-modules`}
        className={`${mobileOpen ? 'block' : 'hidden'} flex-1 space-y-1 overflow-y-auto px-3 py-4 [scrollbar-width:none] md:block`}
        aria-label={`${domain.label} modules`}
        data-nav-layer="logical-module"
      >
        {PM_MODULES.map((module) => {
          const Icon = module.icon
          const active = activeModule?.id === module.id
          const href = moduleHref(module)
          if (!href) {
            const panelId = `${panelPrefix}-${module.id.replaceAll('.', '-')}`
            const expanded = openPlannedId === module.id
            return (
              <div key={module.id}>
                <button
                  ref={(node) => {
                    plannedTriggerRefs.current[module.id] = node
                  }}
                  type="button"
                  className="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-white/65 transition hover:bg-white/5 hover:text-white"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  data-module-id={module.id}
                  data-module-status="PLANNED_MODULE"
                  onClick={() => setOpenPlannedId((current) => (current === module.id ? null : module.id))}
                >
                  <Icon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 whitespace-normal break-words font-bold leading-4">{module.label}</span>
                  <span className="rounded-full border border-white/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/60">Planned</span>
                  <ChevronDown size={15} aria-hidden className={`shrink-0 transition ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && (
                  <div id={panelId} className="mx-2 mb-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2" role="group" aria-label={`${module.label} planned capabilities`}>
                    <p className="text-[11px] leading-4 text-white/70">Planned — not available yet. These named capabilities are being prepared.</p>
                    <ul className="mt-2 space-y-1">
                      {module.businessTabs.map((tab) => (
                        <li key={tab.id} className="flex items-center justify-between gap-2 text-xs text-white/60" data-local-surface-id={tab.id}>
                          <span>{tab.label}</span>
                          <span className="text-right text-[9px] uppercase tracking-wide text-white/45">Planned — not available yet</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          }
          return (
            <Link
              key={module.id}
              href={href}
              aria-label={module.label}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex items-start gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-300 ${
                active
                  ? 'bg-[var(--brand)] text-[#1A1710] shadow-[0_0_15px_var(--brand-glow)]'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`}
              data-module-id={module.id}
              data-module-status="LIVE"
              onClick={navigate}
            >
              <Icon className={`h-5 w-5 shrink-0 transition-transform ${active ? 'scale-110' : 'group-hover:scale-110'}`} aria-hidden />
              <span className="min-w-0 flex-1 whitespace-normal break-words font-bold leading-4">{module.label}</span>
            </Link>
          )
        })}
        {projectContext && (
          <div className="mt-3 border-t border-white/10 pt-3">
            <Link
              href="/projects"
              aria-label="All projects"
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-white/65 transition hover:bg-white/5 hover:text-white"
              data-scope-navigation="business"
              onClick={clearProjectContext}
            >
              All projects
            </Link>
          </div>
        )}
      </nav>
    </aside>
  )
}
