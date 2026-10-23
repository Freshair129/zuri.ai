import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  listLineProductDisclosure,
  previewLineProductDisclosure,
  setLineProductDisclosure,
  withdrawLineProductDisclosure,
} from '@/modules/knowledge/line-product-disclosure-service'

// @req FR-235 — Business owners inspect, preview, approve or withdraw selected
//   customer-safe product facts for one LINE OA account.
// @spec ADR-098, ADR-106; SEC-001; docs/change-requests/integration/line-customer-product-disclosure-20261024.md
// @tested tests/unit/line-product-disclosure-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = new URL(request.url).searchParams
    return listLineProductDisclosure({
      businessId: query.get('businessId') ?? undefined,
      accountId: params?.id,
      q: query.get('q') ?? undefined,
      sourceQuery: query.get('sourceQuery') || undefined,
      sourceCursor: query.get('sourceCursor') || undefined,
    }, { viewer })
  })
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw httpError(400, 'LINE_PRODUCT_DISCLOSURE_INPUT_INVALID')
    }
    const accountId = params?.id
    const common = { businessId: body.businessId, accountId, productId: body.productId }

    switch (body.action) {
      case 'PREVIEW':
        return previewLineProductDisclosure({
          ...common,
          sourceId: body.sourceId,
          fields: body.fields,
        }, { viewer })
      case 'APPROVE':
        return setLineProductDisclosure({
          ...common,
          sourceId: body.sourceId,
          fields: body.fields,
          expectedVersion: body.expectedVersion,
          previewHash: body.previewHash,
          reason: body.reason,
        }, { viewer })
      case 'WITHDRAW':
        return withdrawLineProductDisclosure({
          ...common,
          expectedVersion: body.expectedVersion,
          reason: body.reason,
        }, { viewer })
      default:
        throw httpError(400, 'LINE_PRODUCT_DISCLOSURE_ACTION_INVALID')
    }
  })
}
