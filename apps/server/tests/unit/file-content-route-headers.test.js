// @req FR-045 — managed file content is served so stored content can never run as the application:
// only an allow-list renders inline, text is always plain text, everything carries nosniff and a
// sandboxing CSP, and anything else downloads as an attachment.
// @spec SEC-007, SEC-008, SDD-023
// @tested tests/unit/file-content-route-headers.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const mocks = vi.hoisted(() => ({ asset: null }))

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/project-manager/application/file-asset-service', () => ({
  resolveFileAssetContent: vi.fn(async () => ({ asset: mocks.asset, content: Buffer.from('<script>alert(1)</script>') })),
}))

const { resolveRequestViewer } = await import('@/modules/identity/request-viewer')
const { GET } = await import('@/app/api/files/[id]/content/route')

async function serve(mime, name = 'upload.bin') {
  mocks.asset = { id: 'fa-1', name, mime }
  const response = await GET(new Request('http://localhost/api/files/fa-1/content'), { params: { id: 'fa-1' } })
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    disposition: response.headers.get('content-disposition') || '',
    nosniff: response.headers.get('x-content-type-options'),
    csp: response.headers.get('content-security-policy') || '',
  }
}

describe('GET /api/files/[id]/content response headers', () => {
  beforeEach(() => { resolveRequestViewer.mockResolvedValue(makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })) })

  it('never serves HTML as HTML: it becomes inline plain text', async () => {
    const r = await serve('text/html', 'page.html')
    expect(r.status).toBe(200)
    expect(r.type).toBe('text/plain; charset=utf-8')
    expect(r.nosniff).toBe('nosniff')
    expect(r.csp).toContain('sandbox')
  })

  it('downloads SVG as an attachment instead of rendering it on the app origin', async () => {
    const r = await serve('image/svg+xml', 'logo.svg')
    expect(r.disposition).toMatch(/^attachment;/)
    expect(r.nosniff).toBe('nosniff')
    expect(r.csp).toContain('sandbox')
  })

  it('downloads an unlisted type as an opaque attachment', async () => {
    const r = await serve('application/javascript', 'app.js')
    expect(r.type).toBe('application/octet-stream')
    expect(r.disposition).toMatch(/^attachment;/)
    expect(r.nosniff).toBe('nosniff')
  })

  it('keeps raster image preview inline', async () => {
    const r = await serve('image/png', 'photo.png')
    expect(r.type).toBe('image/png')
    expect(r.disposition).toMatch(/^inline;/)
    expect(r.nosniff).toBe('nosniff')
  })

  it('keeps PDF preview inline', async () => {
    const r = await serve('application/pdf', 'doc.pdf')
    expect(r.type).toBe('application/pdf')
    expect(r.disposition).toMatch(/^inline;/)
    expect(r.nosniff).toBe('nosniff')
  })
})
