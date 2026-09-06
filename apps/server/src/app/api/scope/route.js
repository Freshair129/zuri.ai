// @req FR-001, FR-020 — scope hierarchy CRUD (portfolio/tenant/business/workspace); one-step tenant+business+workspace creation
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-074 — each creator is authorized at the scope it writes: Business
// ownership, Tenant ownership, self-service provisioning, or FR-075 operator
// authority for the primitives above any Tenant.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr074-scope-creation-authorization.test.js
// @req FR-046 — the compatibility scope inventory is filtered to the trusted
// viewer's visible Businesses before it reaches the shell.
// @spec SEC-001, SEC-008
// @tested tests/unit/authorization-seam-routes.test.js
import { handle } from '../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator, seesBusiness } from '@/modules/identity/viewer-authority'
import {
  listScope,
  createPortfolio,
  createTenant,
  createBusiness,
  createBusinessInGroup,
  createWorkspace,
  createLegalEntity,
  createBranch,
} from '@/modules/project-manager/application/scope-service'

export const dynamic = 'force-dynamic'

function visibleScope(scope, viewer) {
  if (isInstallationOperator(viewer)) return scope

  const businesses = scope.businesses.filter((business) => seesBusiness(viewer, business.id))
  const businessIds = new Set(businesses.map((business) => business.id))
  const tenantIds = new Set(businesses.map((business) => business.tenantId))
  const portfolioIds = new Set(
    scope.tenants.filter((tenant) => tenantIds.has(tenant.id)).map((tenant) => tenant.portfolioId)
  )
  const workspaces = scope.workspaces.filter((workspace) =>
    (workspace.businessId && businessIds.has(workspace.businessId))
    || (workspace.scopeType === 'PORTFOLIO' && portfolioIds.has(workspace.portfolioId))
    || (workspace.scopeType === 'TENANT' && tenantIds.has(workspace.tenantId))
  )
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id))

  return {
    portfolios: scope.portfolios.filter((portfolio) => portfolioIds.has(portfolio.id)),
    tenants: scope.tenants.filter((tenant) => tenantIds.has(tenant.id)),
    businesses,
    workspaces,
    projects: scope.projects.filter((project) =>
      (project.businessId && businessIds.has(project.businessId))
      || (!project.businessId && workspaceIds.has(project.workspaceId))
    ),
  }
}

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return visibleScope(await listScope(), viewer)
  })
}

const CREATORS = {
  portfolio: createPortfolio,
  tenant: createTenant,
  business: createBusiness,
  // FR-020 — one call creates tenant + business + starter workspace.
  businessInGroup: createBusinessInGroup,
  workspace: createWorkspace,
  legalEntity: createLegalEntity,
  branch: createBranch,
}

export async function POST(request) {
  return handle(async () => {
    // Resolved before the body is read, so an unauthenticated caller learns
    // nothing — not even which entity names this endpoint accepts.
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    const creator = CREATORS[body.entity]
    if (!creator) throw new Error(`Unknown scope entity: ${body.entity}`)
    // Each creator takes the viewer and decides for itself. The seven write at
    // four different scopes, so there is no single check this handler could make
    // on their behalf that would not be wrong for most of them — which is the
    // whole reason this route stayed on the baseline while the others were paid.
    return creator(body.data, { viewer })
  })
}
