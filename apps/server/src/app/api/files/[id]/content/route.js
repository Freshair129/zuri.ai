// @req FR-045 - authorized managed local-file content read.
// @spec SDD-023, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
// @req FR-045 — stored content never runs as the application: the stored mime is
// client-declared, so only raster images and PDF render inline, any text/* is served
// as plain text, everything else downloads, and every response carries nosniff and a
// sandboxing CSP.
// @tested tests/unit/file-content-route-headers.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

// Types a browser renders without executing anything. SVG is deliberately absent:
// it is XML that can carry script. The File Manager still previews SVG through
// <img>, which never executes it and ignores Content-Disposition.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'application/pdf'])
// `sandbox` gives the document a unique opaque origin even if a browser renders it.
// PDF is exempt: Chromium refuses to start its PDF viewer inside a sandboxed document.
const SANDBOX_CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"

function presentation(mime) {
  const type = String(mime || '').split(';')[0].trim().toLowerCase()
  if (INLINE_TYPES.has(type)) return { type, disposition: 'inline', csp: type === 'application/pdf' ? null : SANDBOX_CSP }
  if (type.startsWith('text/')) return { type: 'text/plain; charset=utf-8', disposition: 'inline', csp: SANDBOX_CSP }
  if (type === 'image/svg+xml') return { type, disposition: 'attachment', csp: SANDBOX_CSP }
  return { type: 'application/octet-stream', disposition: 'attachment', csp: SANDBOX_CSP }
}

export async function GET(request, { params }) {
  try {
    const viewer = await resolveRequestViewer(request)
    const { asset, content } = await resolveFileAssetContent(params.id, { visibleBusinessIds: viewer.visibleBusinessIds })
    const safeName = asset.name.replace(/["\r\n]/g, '_')
    const { type, disposition, csp } = presentation(asset.mime)
    const headers = {
      'Content-Type': type,
      'Content-Length': String(content.length),
      'Content-Disposition': `${disposition}; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    }
    if (csp) headers['Content-Security-Policy'] = csp
    return new Response(content, { headers })
  } catch (error) {
    return Response.json({ error: error?.message || 'Unable to read file' }, { status: /not found/i.test(error?.message || '') ? 404 : 400 })
  }
}
