'use client'

// @req FR-034, FR-039, FR-043, FR-044 — breadcrumb mirrors shell context, direct Project ownership, and stays inside BusinessShell.
// @spec SDD-013, SDD-018, SDD-021, ADR-011, ADR-014
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
  const shellRoot = '/overview'

  const crumbs = []
  if (scope.currentPortfolio) {
    crumbs.push({ label: scope.currentPortfolio.name, eyebrow: 'Workspace', href: shellRoot, switcher: true })
  } else {
    crumbs.push({ label: view.allLabel, href: shellRoot, switcher: true })
  }
  if (displayTenant) {
    crumbs.push({ 
      label: displayTenant.name, 
      eyebrow: 'Organization',
      href: '/businesses',
      switcher: true,
      ariaLabel: 'Select Business from Organization'
    })
  }
  if (displayBusiness) {
    crumbs.push({ label: displayBusiness.name, eyebrow: 'Business' })
  }
  if (project) {
    crumbs.push({ label: project.code || project.name, eyebrow: 'Project' })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-white/55">
      <Link href={shellRoot} aria-label="Home" className="shrink-0 transition hover:text-white">
        <House size={13} aria-hidden />
      </Link>
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
          <ChevronRight size={12} aria-hidden className="shrink-0 opacity-30" />
          {crumb.href && (crumb.switcher || index < crumbs.length - 1) ? (
            <Link 
              href={crumb.href} 
              className="truncate transition hover:text-white" 
              title={crumb.eyebrow}
              aria-label={crumb.ariaLabel}
            >
              {crumb.label}
            </Link>
          ) : (
            <span className={`truncate ${index === crumbs.length - 1 ? 'font-bold text-white/90' : ''}`} title={crumb.eyebrow}>
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}
