// @req FR-137 — authorized, content-verified private Asset evidence upload.
// @spec SDD-081, NFR-022, SEC-024, ADR-056
// @tested tests/unit/asset-evidence-route-schema-contract.test.js
import { handle, httpError } from '@/app/api/_helpers'
import { resolveAssetRequestScope } from '@/modules/asset-management/application/asset-request-scope'
import { uploadAssetEvidence } from '@/modules/asset-management/application/asset-evidence-service'
import { createConfiguredAssetObjectStoragePort } from '@/platform/storage/supabase-object-storage'
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
    if (!(file instanceof Blob) || !file.name) throw httpError(400, 'Evidence file is required')
    if (file.size > 20 * 1024 * 1024) throw httpError(413, 'Evidence exceeds the 20 MiB limit')
    const content = Buffer.from(await file.arrayBuffer())
    const evidence = await uploadAssetEvidence({ businessId, name: file.name, mime: file.type, content }, {
      viewer,
      objectStoragePort: createConfiguredAssetObjectStoragePort(),
    })
    return { evidence }
  })
}
