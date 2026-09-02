// @req FR-139 — bounded Google Sheets-ready intake export without provider secrets.
// @spec SDD-083, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { listAssetIntakesForExport } from '@/modules/asset-management/application/asset-intake-service'
import { buildAssetExportWorkbook } from '@/modules/asset-management/import/xlsx-template'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const businessId = new URL(request.url).searchParams.get('businessId')
    if (!businessId) throw httpError(400, 'businessId is required')
    const viewer = await resolveRequestViewer(request)
    await resolveAssetRequestScope(request, businessId, { viewer })
    const intakes = await listAssetIntakesForExport(businessId, { viewer })
    const workbook = buildAssetExportWorkbook(intakes)
    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, { status: 200, headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="zuri-asset-intakes.xlsx"',
    } })
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to export Asset intakes' }, { status: Number(error?.status) || 500 })
  }
}
