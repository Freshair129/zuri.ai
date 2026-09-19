import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertMayWriteSupplierCostSheets } from '@/modules/procurement/application/procurement-authority'
import { buildSupplierCostTemplateWorkbook } from '@/modules/procurement/import/supplier-cost-workbook'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   the downloadable workbook carries the exact CostSheet header contract and
//   never contains product or supplier data.
// @tested tests/unit/supplier-cost-sheet-routes.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const viewer = await resolveRequestViewer(request)
    const query = new URL(request.url).searchParams
    const businessId = query.get('businessId') || ''
    assertMayWriteSupplierCostSheets(viewer, businessId)
    const workbook = buildSupplierCostTemplateWorkbook({
      currency: query.get('currency') || 'USD',
      fxRateLocked: query.get('fxRateLocked') || '',
    })
    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="zuri-supplier-cost-sheet-template.xlsx"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to build template' }, { status: Number(error?.status) || 500 })
  }
}
