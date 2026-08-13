'use client'

// @req FR-034, FR-039, FR-043, FR-044 — breadcrumb mirrors shell context, direct Project ownership, and Business return path.
// @spec SDD-018, SDD-021, ADR-011, ADR-014
// @tested tests/unit/breadcrumb-switcher.test.js, tests/unit/scope-view-context.test.js
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, House } from 'lucide-react'
import { useScope } from '@/context/ScopeContext'

export default function Breadcrumb() {
  const pathname = usePathname()
  const scope = useScope()
  const { view } = scope
  const routeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1]
  const routeProject = scope.projects.find((project) => project.id === routeProjectId) || null
  const project = routeProject
  const routeBusiness = project?.businessId
    ? scope.businesses.find((business) => business.id === project.businessId) || null
    : null
  const displayBusiness = scope.currentBusiness || routeBusiness
  const displayTenant = scope.currentTenant || (routeBusiness
    ? scope.tenants.find((tenant) => tenant.id === routeBusiness.tenantId) || null
    : null)

  const crumbs = []
  if (scope.currentPortfolio) {
    crumbs.push({ label: scope.currentPortfolio.name, eyebrow: 'Workspace', href: '/', switcher: true })
  } else {
    crumbs.push({ label: view.allLabel, href: '/', switcher: true })
  }
  if (displayTenant) {
    crumbs.push({ label: displayTenant.name, eyebrow: 'Organization' })
  }
  if (displayBusiness) {
    crumbs.push({ label: displayBusiness.name, eyebrow: 'Business' })
  }
  if (project) {
    crumbs.push({ label: project.code || project.name, eyebrow: 'Project' })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--muted)]">
      <Link href="/" aria-label="Home" className="shrink-0 transition hover:text-[var(--text)]">
        <House size={13} aria-hidden />
      </Link>
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
          <ChevronRight size={12} aria-hidden className="shrink-0 opacity-50" />
          {crumb.href && (crumb.switcher || index < crumbs.length - 1) ? (
            <Link href={crumb.href} className="truncate transition hover:text-[var(--text)]" title={crumb.eyebrow}>
              {crumb.label}
            </Link>
          ) : (
            <span className={`truncate ${index === crumbs.length - 1 ? 'font-semibold text-[var(--text)]' : ''}`} title={crumb.eyebrow}>
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}
