import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listCategories, listProductMasters } from '@/modules/inventory/application/inventory-catalog-service'
import { buildCatalogTemplateWorkbook } from '@/modules/inventory/import/catalog-workbook'

// @req FR-209 — download the catalogue intake workbook for one Business: the
//   `Products` sheet whose header row is the contract, dropdowns from
//   `enums.js`, and a `Lookups` sheet of this Business's own categories and
//   masters. Business visibility plus the `inventory` domain; a refusal is the
//   FR-072 404 as JSON, never a partial file.
// @spec ADR-084 D3; SEC-001
// @tested tests/unit/inventory-routes.test.js, tests/unit/inventory-catalog-workbook.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  try {
    const viewer = await resolveRequestViewer(request)
    const businessId = new URL(request.url).searchParams.get('businessId')
    const [categories, masters] = await Promise.all([
      listCategories({ businessId, viewer }),
      listProductMasters({ businessId, viewer }),
    ])
    const workbook = buildCatalogTemplateWorkbook({ categories: categories.filter((c) => c.status !== 'ARCHIVED'), masters: masters.filter((m) => m.status !== 'ARCHIVED') })
    const buffer = await workbook.xlsx.writeBuffer()
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="zuri-catalog-intake-template.xlsx"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to build template' }, { status: Number(error?.status) || 500 })
  }
}
