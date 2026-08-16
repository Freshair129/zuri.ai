import { domainForPath, isDomainVisible } from '@/config/domains'
import { domainsForBusiness } from '@/modules/identity/viewer-domains'

// @req FR-044 — Business selection and viewer access are resolved before the
// BusinessShell/AppShell is mounted.
// @spec ADR-015, SDD-022 — AUTH_REQUIRED, BUSINESS_REQUIRED, READY, FORBIDDEN,
// NOT_FOUND route decisions; Project.businessId remains the owner.
// @tested tests/unit/business-shell-guard.test.js

const ENTRY_PATHS = new Set(['/', '/login', '/businesses'])

export function projectIdFromPath(pathname = '') {
  const match = String(pathname).match(/^\/projects\/([^/]+)/)
  if (!match || match[1] === 'new') return null
  return decodeURIComponent(match[1])
}

function visibleDomain(viewer, domainKey, businessId) {
  // @req FR-060 — delegated to the registry so an `alwaysVisible` slot (Business
  // Home) is honoured identically here and in DomainBar. The undefined fallback
  // for old local fixtures is preserved inside `isDomainVisible`.
  // @req FR-061 — the allow-list is the one for THIS Business. `visibleDomains`
  // is the union across every visible Business, so using it here would let a
  // principal who owns Business A open A's domains inside Business B.
  return isDomainVisible(domainKey, domainsForBusiness(viewer, businessId))
}

/**
 * Resolve the client route decision without rendering BusinessShell.
 *
 * The helper intentionally treats a sole Business as BUSINESS_REQUIRED until
 * the routing page persists an explicit selection. This keeps `/businesses`
 * observable in the FR-044 proof slice and avoids reintroducing an implicit
 * Business choice inside the shell.
 *
 * @param {{ pathname?: string, scopeLoaded?: boolean, viewerLoading?: boolean,
 *   viewerError?: string|null, selection?: object, businesses?: object[],
 *   projects?: object[], viewer?: object|null }} input
 * @returns {{state: 'BYPASS'|'LOADING'|'AUTH_REQUIRED'|'BUSINESS_REQUIRED'|'READY'|'FORBIDDEN'|'NOT_FOUND', redirect?: string, businessId?: string, reason?: string, domain?: string}}
 */
export function resolveBusinessShellDecision({
  pathname = '',
  scopeLoaded = false,
  viewerLoading = false,
  viewerError = null,
  selection = {},
  businesses = [],
  projects = [],
  viewer = null,
} = {}) {
  if (ENTRY_PATHS.has(pathname)) return { state: 'BYPASS' }
  if (viewerError) return { state: 'AUTH_REQUIRED', redirect: '/login', reason: 'VIEWER_ERROR' }
  if (viewerLoading || !scopeLoaded) return { state: 'LOADING' }
  if (!viewer) return { state: 'AUTH_REQUIRED', redirect: '/login' }

  const businessId = selection?.businessId || null
  if (!businessId) return { state: 'BUSINESS_REQUIRED', redirect: '/businesses' }

  const business = businesses.find((candidate) => candidate.id === businessId)
  const visibleBusinessIds = Array.isArray(viewer.visibleBusinessIds) ? viewer.visibleBusinessIds : []
  if (!business || !visibleBusinessIds.includes(businessId)) {
    return { state: 'FORBIDDEN', redirect: '/businesses', reason: 'BUSINESS_ACCESS' }
  }

  // Business Overview is the BusinessShell root, not the Development domain;
  // a viewer may be granted another domain while still reaching this root.
  // Profile is an identity/platform surface, not a Development fallback route.
  const domain = pathname === '/overview'
    ? null
    : pathname === '/profile' || pathname.startsWith('/profile/')
      ? { key: 'platform' }
      : domainForPath(pathname)
  if (domain && !visibleDomain(viewer, domain.key, businessId)) {
    return { state: 'FORBIDDEN', redirect: '/overview', reason: 'DOMAIN_ACCESS', domain: domain.key }
  }

  const projectId = projectIdFromPath(pathname)
  if (projectId) {
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project) {
      return { state: 'NOT_FOUND', reason: 'PROJECT_NOT_FOUND' }
    }
    // Only a known direct owner mismatch is safe to redirect here. Shared
    // portfolio/tenant work (`businessId: null`) remains visible in context.
    if (project && project.businessId != null && project.businessId !== businessId) {
      return { state: 'FORBIDDEN', redirect: '/overview', reason: 'PROJECT_BUSINESS_MISMATCH' }
    }
  }

  return { state: 'READY', businessId }
}
