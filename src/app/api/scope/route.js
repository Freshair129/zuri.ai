// @req FR-001, FR-020 — scope hierarchy CRUD (portfolio/tenant/business/workspace); one-step tenant+business+workspace creation
import { handle } from '../_helpers'
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
    const body = await request.json()
    const creator = CREATORS[body.entity]
    if (!creator) throw new Error(`Unknown scope entity: ${body.entity}`)
    return creator(body.data)
  })
}
