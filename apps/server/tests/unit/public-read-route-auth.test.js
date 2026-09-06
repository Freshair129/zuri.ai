import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer.js'

const { resolveRequestViewer } = vi.hoisted(() => ({
  resolveRequestViewer: vi.fn(),
}))

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

import { GET as getDocs } from '@/app/api/docs/route'
import { GET as getTemplate } from '@/app/api/import/template/route'

const request = (url) => new Request(url)
const authRequired = Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })

describe('public/read API route authorization', () => {
  beforeEach(() => resolveRequestViewer.mockReset())
  afterEach(() => vi.restoreAllMocks())

  it('/api/docs remains public on exact loopback hosts', async () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const response = await getDocs(request(`http://${host}/api/docs`))
      expect(response.status, host).toBe(200)
    }
    expect(resolveRequestViewer).not.toHaveBeenCalled()
  })

  it('/api/docs requires the trusted viewer outside loopback', async () => {
    resolveRequestViewer.mockRejectedValue(authRequired)
    const outsideRequest = request('https://docs.example.test/api/docs')

    const response = await getDocs(outsideRequest)

    expect(response.status).toBe(401)
    expect(resolveRequestViewer).toHaveBeenCalledWith(outsideRequest)
  })

  it('/api/docs serves an authenticated non-loopback request', async () => {
    resolveRequestViewer.mockResolvedValue(makeViewer())

    const response = await getDocs(request('https://docs.example.test/api/docs'))

    expect(response.status).toBe(200)
    expect(resolveRequestViewer).toHaveBeenCalledTimes(1)
  })

  it('/api/import/template fails closed without a trusted viewer', async () => {
    resolveRequestViewer.mockRejectedValue(authRequired)
    const unauthenticatedRequest = request('http://localhost/api/import/template')

    const response = await getTemplate(unauthenticatedRequest)

    expect(response.status).toBe(401)
    expect(resolveRequestViewer).toHaveBeenCalledWith(unauthenticatedRequest)
  })

  it('/api/import/template returns the workbook only after viewer resolution', async () => {
    resolveRequestViewer.mockResolvedValue(makeViewer())
    const authenticatedRequest = request('http://localhost/api/import/template')

    const response = await getTemplate(authenticatedRequest)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('spreadsheetml')
    expect(resolveRequestViewer).toHaveBeenCalledWith(authenticatedRequest)
  })
})
