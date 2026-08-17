// @req FR-001, FR-020 — scope hierarchy CRUD (portfolio/tenant/business/workspace); one-step tenant+business+workspace creation
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-074 — each creator is authorized at the scope it writes: Business
// ownership, Tenant ownership, self-service provisioning, or FR-075 operator
// authority for the primitives above any Tenant.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr074-scope-creation-authorization.test.js
import { handle } from '../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
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

export async function GET() {
  return handle(() => listScope())
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
