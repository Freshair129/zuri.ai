import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertMayManage } from '@/modules/inventory/application/inventory-authority'
import { previewCatalogIntake } from '@/modules/inventory/application/catalog-intake-service'
import { CATALOG_INTAKE_SCHEMA_VERSION } from '@/modules/inventory/domain/catalog-intake'
import { readCatalogWorkbook } from '@/modules/inventory/import/catalog-workbook'

// @req FR-209 — upload a catalogue workbook (multipart `file`, `.xlsx`, at most
//   5 MiB, plus `businessId`). Authority is checked BEFORE the file is read;
//   the reader converts rows into envelope items without judging them, and the
//   result is a PREVIEW under correlation `xlsx:<sha256 of the file>` — the same
//   pipeline JSON uses. Nothing is committed here: no hidden apply.
// @spec ADR-084 D3; BR-009; SEC-001; ADR-056 D7
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr208-inventory-catalog-intake.test.js

export const dynamic = 'force-dynamic'

const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const form = await request.formData().catch(() => null)
    if (!form) throw httpError(400, 'multipart form data is required')
    const businessId = typeof form.get('businessId') === 'string' ? form.get('businessId').trim() : ''
    assertMayManage(viewer, businessId)
    const file = form.get('file')
    if (!(file instanceof Blob) || !String(file.name || '').toLowerCase().endsWith('.xlsx')) throw httpError(400, '.xlsx file is required')
    if (file.size > MAX_BYTES) throw httpError(413, 'Workbook exceeds the 5 MiB limit')
    const { items, correlationId } = await readCatalogWorkbook(Buffer.from(await file.arrayBuffer()))
    return previewCatalogIntake({ schemaVersion: CATALOG_INTAKE_SCHEMA_VERSION, businessId, source: { channel: 'EXCEL', correlationId }, items }, { viewer })
  })
}
