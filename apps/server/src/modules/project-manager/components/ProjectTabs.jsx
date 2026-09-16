'use client'

// @req FR-247 — Project-local navigation follows the active logical module.
// Project Management and Resource Coordination expose their live local tabs;
// Work keeps its existing seven-view row in WorkViewTabs.
// @req FR-065 — one PM-owned Import plan action is reachable from every
// authorized live Project module shell and returns to the Project overview.
// @req FR-077 — Inventory remains a read-only Project Management surface.
// @spec ADR-095, SDD-019
// @tested tests/unit/project-work-route.test.js
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CircleDot,
  ClipboardList,
  FileText,
  Folder,
  GitBranch,
  ListTree,
  Upload,
  Users,
} from 'lucide-react'
import {
  PM_SHARED_ACTIONS,
  moduleForProjectPath,
  projectActionPath,
  projectPath,
} from '@/modules/project-manager/navigation'

const TAB_ICONS = {
  'pm.project-overview': CircleDot,
  'pm.inventory': ClipboardList,
  'rc.team': Users,
  'rc.files': Folder,
  'rc.repositories': GitBranch,
}

export default function ProjectTabs({ projectId, activeModule, authorizedProject }) {
  const pathname = usePathname()
  if (!authorizedProject) return null

  const module = activeModule || null
  const tabs = module?.projectTabs || []
  const plannedTabs = module?.plannedProjectTabs || []
  const importHref = projectActionPath(projectId)
  const returnHref = projectPath(projectId, PM_SHARED_ACTIONS.importPlan.returnSuffix)
  const importIsCurrent = pathname === importHref
  const tabClass = (active) => `flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${
    active
      ? 'bg-[#eaf0ff] text-[#2f4fe0]'
      : 'text-[var(--muted)] hover:bg-[var(--surface-mid)] hover:text-[var(--text)]'
  }`

  return (
    <header
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-1.5"
      data-project-id={projectId}
      data-module-id={module?.id}
    >
      {tabs.length > 0 ? (
        <nav
          aria-label={`${module.label} project sections`}
          className="flex min-w-0 items-center gap-1 overflow-x-auto"
          data-local-surface-scope="PROJECT"
        >
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.id] || FileText
            const href = projectPath(projectId, tab.suffix)
            const active = pathname === href
              || (tab.id === 'pm.project-overview'
                && module?.id === 'module.project-management'
                && moduleForProjectPath(pathname, projectId)?.id === 'module.project-management'
                && pathname.startsWith(`${projectPath(projectId)}/execution/`))
            return (
              <Link
                key={tab.id}
                href={href}
                aria-current={active ? 'page' : undefined}
                aria-label={tab.readOnly ? `${tab.label} (read only)` : tab.label}
                className={tabClass(active)}
                data-local-surface-id={tab.id}
              >
                <Icon size={15} aria-hidden />
                {tab.label}
                {tab.readOnly && <span className="text-[10px] font-medium text-[var(--muted)]">Read only</span>}
              </Link>
            )
          })}
        </nav>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-3 py-2" data-local-surface-scope="PROJECT">
          <ListTree size={15} aria-hidden className="shrink-0 text-[var(--muted)]" />
          <span className="truncate text-xs font-semibold text-[var(--text)]">{module?.label || 'Project navigation'}</span>
          {module?.id === 'module.work-management' && <span className="text-[10px] text-[var(--muted)]">Seven Work views below</span>}
          {!module && <span className="text-[10px] text-[var(--muted)]">Current route has no local view</span>}
        </div>
      )}

      {plannedTabs.length > 0 && (
        <div
          className="flex min-w-0 flex-wrap items-center gap-1 px-1"
          role="group"
          aria-label={`${module.label} planned capabilities`}
          data-planned-surface-scope="PROJECT"
        >
          <span className="px-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Planned</span>
          {plannedTabs.map((tab) => (
            <span
              key={tab.id}
              aria-disabled="true"
              aria-label={`${tab.label} — Planned — not available yet`}
              className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)]"
              data-local-surface-id={tab.id}
            >
              {tab.label}
              <span className="ml-1 text-[9px]">Planned — not available yet</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <Link
          href={importHref}
          aria-current={importIsCurrent ? 'page' : undefined}
          aria-label={PM_SHARED_ACTIONS.importPlan.label}
          className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition ${
            importIsCurrent
              ? 'bg-[var(--brand)] text-[#1a1710] shadow-[0_0_15px_var(--brand-glow)]'
              : 'text-[var(--brand-dark)] hover:bg-[var(--brand-tint)]'
          }`}
          data-action-id={PM_SHARED_ACTIONS.importPlan.id}
          data-owner-module-id={PM_SHARED_ACTIONS.importPlan.ownerModuleId}
          data-return-path={returnHref}
        >
          <Upload size={15} aria-hidden />
          {PM_SHARED_ACTIONS.importPlan.label}
        </Link>
        {importIsCurrent && (
          <Link
            href={returnHref}
            aria-label="Return to Project overview"
            className="flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-[var(--muted)] hover:bg-[var(--surface-mid)] hover:text-[var(--text)]"
            data-return-action="project-overview"
          >
            Back to Project
          </Link>
        )}
      </div>
    </header>
  )
}
