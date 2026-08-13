// @req FR-045 - authorized managed local-file content read.
// @spec SDD-023, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function GET(_request, { params }) {
  try {
    const viewer = await resolveViewer()
    const { asset, content } = await resolveFileAssetContent(params.id, { visibleBusinessIds: viewer.visibleBusinessIds })
    const safeName = asset.name.replace(/["\r\n]/g, '_')
    return new Response(content, { headers: {
      'Content-Type': asset.mime || 'application/octet-stream',
      'Content-Length': String(content.length),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store',
    } })
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to read file' }, { status: /not found/i.test(error?.message || '') ? 404 : 400 })
  }
}
