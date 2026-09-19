import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertMayWriteSupplierCostSheets } from '@/modules/procurement/application/procurement-authority'
import { previewSupplierCostSheet } from '@/modules/procurement/application/supplier-cost-sheet-service'
import { readSupplierCostWorkbook } from '@/modules/procurement/import/supplier-cost-workbook'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   authority is checked before reading a bounded .xlsx upload; the reader
//   returns a byte hash and the same preview pipeline as JSON.
// @tested tests/unit/supplier-cost-sheet-routes.test.js

export const dynamic = 'force-dynamic'

const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const form = await request.formData().catch(() => null)
    if (!form) throw httpError(400, 'multipart form data is required')
    const businessId = typeof form.get('businessId') === 'string' ? form.get('businessId').trim() : ''
    const supplierId = typeof form.get('supplierId') === 'string' ? form.get('supplierId').trim() : ''
    const currency = typeof form.get('currency') === 'string' ? form.get('currency').trim() : ''
    const fxRateLocked = Number(form.get('fxRateLocked'))
    assertMayWriteSupplierCostSheets(viewer, businessId)
    const file = form.get('file')
    if (!(file instanceof Blob) || !String(file.name || '').toLowerCase().endsWith('.xlsx')) throw httpError(400, '.xlsx file is required')
    if (file.size > MAX_BYTES) throw httpError(413, 'Workbook exceeds the 5 MiB limit')
    const { lines, sourceSha256 } = await readSupplierCostWorkbook(Buffer.from(await file.arrayBuffer()))
    return previewSupplierCostSheet({
      businessId,
      supplierId,
      currency,
      fxRateLocked,
      sourceRef: file.name,
      sourceSha256,
      lines,
    }, { viewer })
  })
}
