import { describe, expect, it, vi } from 'vitest'
import { createWorkerObservabilityGet } from '@/modules/platform-control/worker-observability-contract'

const snapshot = { schemaVersion: 'worker-observability/v1', state: 'LIVE', summary: { activeWorkers: 0 } }
const request = (headers = {}, method = 'GET') => new Request('https://zuri.test/api/platform/worker-observability?since=2026-10-16T04%3A00%3A00.000Z', {
  method,
  headers: { Host: 'zuri.test', Origin: 'https://zuri.test', 'Sec-Fetch-Site': 'same-origin', ...headers },
})

describe('worker observability route contract', () => {
  it('authenticates and authorizes before reading any local source', async () => {
    const calls = []
    const handler = createWorkerObservabilityGet({
      resolveViewer: async () => { calls.push('auth'); return null },
      isOperator: () => false,
      readSnapshot: async () => { calls.push('read'); return snapshot },
    })
    const response = await handler(request())
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(calls).toEqual(['auth'])
  })

  it('denies a signed-in non-operator without calling the source', async () => {
    const readSnapshot = vi.fn(async () => snapshot)
    const handler = createWorkerObservabilityGet({ resolveViewer: async () => ({ isOperator: false }),
      isOperator: (viewer) => viewer.isOperator, readSnapshot })
    const response = await handler(request())
    expect(response.status).toBe(403)
    expect(readSnapshot).not.toHaveBeenCalled()
  })

  it('accepts only same-origin GET and returns private no-store data', async () => {
    const readSnapshot = vi.fn(async () => snapshot)
    const handler = createWorkerObservabilityGet({ resolveViewer: async () => ({ isOperator: true }),
      isOperator: (viewer) => viewer.isOperator, readSnapshot })
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toContain('Cookie')
    expect(await response.json()).toEqual(snapshot)
    expect(readSnapshot).toHaveBeenCalledWith({ since: '2026-10-16T04:00:00.000Z' })

    const crossOrigin = await handler(request({ Origin: 'https://attacker.test', 'Sec-Fetch-Site': 'cross-site' }))
    expect(crossOrigin.status).toBe(403)
    expect(readSnapshot).toHaveBeenCalledTimes(1)

    const post = await handler(request({}, 'POST'))
    expect(post.status).toBe(405)
    expect(readSnapshot).toHaveBeenCalledTimes(1)
  })

  it('converts an unavailable reader into an explicit UNKNOWN snapshot', async () => {
    const handler = createWorkerObservabilityGet({ resolveViewer: async () => ({ isOperator: true }),
      isOperator: (viewer) => viewer.isOperator, readSnapshot: async () => { throw new Error('private path must not leak') } })
    const response = await handler(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ schemaVersion: 'worker-observability/v1', state: 'UNKNOWN', freshness: 'UNKNOWN',
      campaignIntake: { state: 'NOT_CAPTURED', authorityGrant: false, dispatchAllowed: false, candidates: [] },
      source: { roadmapIntake: 'NOT_CAPTURED' } })
    expect(JSON.stringify(body)).not.toContain('private path')
  })
})
