// @req FR-139 — Asset workbook preview; no hidden apply.
// @spec SDD-083, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { handle, httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { assetWorkbookToEnvelopes } from '@/modules/asset-management/import/xlsx-convert'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const businessId = request.headers.get('x-zuri-business-id')
    if (!businessId) throw httpError(400, 'x-zuri-business-id is required')
    const viewer = await resolveRequestViewer(request)
    await resolveAssetRequestScope(request, businessId, { capability: 'write', viewer })
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof Blob) || !file.name?.toLowerCase().endsWith('.xlsx')) throw httpError(400, '.xlsx file is required')
    if (file.size > 10 * 1024 * 1024) throw httpError(413, 'Workbook exceeds the 10 MiB limit')
    return assetWorkbookToEnvelopes(Buffer.from(await file.arrayBuffer()), { businessId })
  })
}
