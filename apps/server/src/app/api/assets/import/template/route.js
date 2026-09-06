// @req FR-139 — authorized canonical Asset workbook download.
// @spec SDD-083, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { buildAssetTemplateWorkbook } from '@/modules/asset-management/import/xlsx-template'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const businessId = new URL(request.url).searchParams.get('businessId')
    if (!businessId) throw httpError(400, 'businessId is required')
    const viewer = await resolveRequestViewer(request)
    await resolveAssetRequestScope(request, businessId, { viewer })
    const workbook = buildAssetTemplateWorkbook()
    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, { status: 200, headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="zuri-asset-intake-template.xlsx"',
    } })
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to build template' }, { status: Number(error?.status) || 500 })
  }
}
