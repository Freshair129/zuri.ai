// @req FR-134, FR-135, FR-136 — authenticated, Business-scoped preview of the
// canonical Asset envelope; no upload, OCR, approval, persistence or posting.
// @spec SDD-079, SDD-080, BR-024, SEC-023, ADR-055
// @tested tests/unit/asset-management-contract.test.js, tests/unit/asset-management-api-ui-contract.test.js
import prisma from '@/lib/db'
import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { seesBusiness } from '@/modules/identity/viewer-authority'
import { domainsForBusiness } from '@/modules/identity/viewer-domains'
import { isDomainVisible } from '@/config/domains'
import { validateAssetIntake } from '@/modules/asset-management/domain/asset-intake'
import { calculateStraightLineDepreciation } from '@/modules/asset-management/domain/depreciation'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    const businessId = body?.businessId

    // Refuse before the Business lookup so an id outside the trusted viewer's
    // set cannot become an existence oracle.
    if (!seesBusiness(viewer, businessId)) throw httpError(404, 'Business not found')
    if (!isDomainVisible('assets', domainsForBusiness(viewer, businessId))) {
      throw httpError(403, 'Asset Management is not enabled for this Business')
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, tenantId: true },
    })
    if (!business) throw httpError(404, 'Business not found')

    const validation = validateAssetIntake(body, {
      trustedTenantId: business.tenantId,
      trustedBusinessId: business.id,
    })
    const depreciationPreview = validation.ok && validation.value.depreciation
      ? calculateStraightLineDepreciation(validation.value.depreciation)
      : null

    return {
      mode: 'PREVIEW_ONLY',
      applied: false,
      providerActions: [],
      validation,
      depreciationPreview,
      unavailableAdapters: ['LINE_BINARY', 'OCR_VISION', 'GOOGLE_SHEET_SYNC', 'PROCUREMENT_LOOKUP', 'FINANCE_POSTING'],
    }
  })
}
