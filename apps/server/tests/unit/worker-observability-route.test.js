import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer, makeOperatorViewer } from '../factories/viewer.js'

const { resolveRequestViewer, isInstallationOperator, readWorkerObservabilitySource } = vi.hoisted(() => ({
  resolveRequestViewer: vi.fn(),
  isInstallationOperator: vi.fn(),
  readWorkerObservabilitySource: vi.fn(),
}))

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/identity/viewer-authority', () => ({ isInstallationOperator }))
vi.mock('@/modules/platform-control/application/worker-observability-source', () => ({ readWorkerObservabilitySource }))

import { GET, POST } from '@/app/api/platform/worker-observability/route'

const request = (method = 'GET') => new Request('http://localhost/api/platform/worker-observability', {
  method,
  headers: { Host: 'localhost', Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' },
})

describe('worker observability API route', () => {
  beforeEach(() => {
    resolveRequestViewer.mockReset()
    isInstallationOperator.mockReset()
    readWorkerObservabilitySource.mockReset()
    readWorkerObservabilitySource.mockResolvedValue({ schemaVersion: 'worker-observability/v1', state: 'UNKNOWN' })
  })

  it('does not read controller data for unauthenticated or non-operator viewers', async () => {
    resolveRequestViewer.mockRejectedValueOnce(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    expect((await GET(request())).status).toBe(401)
    expect(readWorkerObservabilitySource).not.toHaveBeenCalled()

    resolveRequestViewer.mockResolvedValueOnce(makeViewer())
    isInstallationOperator.mockReturnValueOnce(false)
    expect((await GET(request())).status).toBe(403)
    expect(readWorkerObservabilitySource).not.toHaveBeenCalled()
  })

  it('reads after the installation-operator check and sends private no-store headers', async () => {
    resolveRequestViewer.mockResolvedValue(makeOperatorViewer())
    isInstallationOperator.mockReturnValue(true)
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ state: 'UNKNOWN' })
    expect(readWorkerObservabilitySource).toHaveBeenCalledTimes(1)
    expect(POST).toBeTypeOf('function')
    expect((await POST(request('POST'))).status).toBe(405)
    expect(readWorkerObservabilitySource).toHaveBeenCalledTimes(1)
  })
})
