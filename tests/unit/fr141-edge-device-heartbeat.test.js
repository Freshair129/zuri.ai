// @req FR-141 — the Edge Device heartbeat route resolves a trusted viewer on
// every method, scopes the registry to owned Businesses, rejects a bad payload
// with 400 instead of registering a default device, never persists or echoes
// the device token, and returns real status codes.
// @spec ADR-041 D3, SEC-001, SEC-008
// @tested tests/unit/fr141-edge-device-heartbeat.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

const mocks = vi.hoisted(() => ({
  resolveRequestViewer: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: mocks.resolveRequestViewer }))
vi.mock('@/lib/db', () => ({ default: { auditEvent: { create: mocks.auditCreate } } }))

const route = await import('@/app/api/agent/heartbeat/route')
const { EDGE_DEVICE_ONLINE_WINDOW_MS, resetEdgeDeviceRegistry } = await import('@/modules/agent/edge-device-registry')
const { httpError } = await import('@/app/api/_helpers')

const ownerA = makeViewer({
  visibleBusinessIds: ['business-a'],
  ownedBusinessIds: ['business-a'],
  principal: { id: 'per-a', code: 'PER-A', displayName: 'Owner A' },
})
const ownerB = makeViewer({
  visibleBusinessIds: ['business-b'],
  ownedBusinessIds: ['business-b'],
  principal: { id: 'per-b', code: 'PER-B', displayName: 'Owner B' },
})
// The attacker shape from the authorization RCAs: OWNER somewhere, merely sees business-a.
const seesAOnly = ownsElsewhere({ owns: 'business-owned', sees: 'business-a' })

const SECRET = 'tok_edge_smartgift_secret'
const url = (qs = '') => `http://localhost/api/agent/heartbeat${qs}`
const get = (qs = '') => route.GET(new Request(url(qs)))
const del = (qs = '') => route.DELETE(new Request(url(qs), { method: 'DELETE' }))
const post = (body) => route.POST(new Request(url(), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}))
const as = (viewer) => mocks.resolveRequestViewer.mockResolvedValue(viewer)
const unauthenticated = () => mocks.resolveRequestViewer.mockRejectedValue(httpError(401, 'AUTH_REQUIRED'))
const heartbeat = (over = {}) => ({
  businessId: 'business-a',
  deviceId: 'DEV-A-1',
  status: 'healthy',
  deviceToken: SECRET,
  registeredQueries: ['sales.daily'],
  engine: 'zuri-edge-runtime',
  ...over,
})
const auditActions = () => mocks.auditCreate.mock.calls.map(([{ data }]) => data.action)

beforeEach(() => {
  vi.clearAllMocks()
  resetEdgeDeviceRegistry()
  mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('FR-141 /api/agent/heartbeat — authentication fails closed on every method', () => {
  it('GET without a trusted viewer is 401 and serves no device list', async () => {
    unauthenticated()
    const res = await get()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('AUTH_REQUIRED')
    expect(body).not.toHaveProperty('devices')
    expect(body).not.toHaveProperty('viewerId')
  })

  it('POST without a trusted viewer is 401 and registers nothing', async () => {
    unauthenticated()
    expect((await post(heartbeat())).status).toBe(401)
    as(ownerA)
    expect((await (await get()).json()).count).toBe(0)
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('DELETE without a trusted viewer is 401 and removes nothing', async () => {
    as(ownerA)
    expect((await post(heartbeat())).status).toBe(200)
    unauthenticated()
    expect((await del()).status).toBe(401)
    expect((await del('?deviceId=DEV-A-1')).status).toBe(401)
    as(ownerA)
    expect((await (await get()).json()).count).toBe(1)
  })

  it('a 503 from the session port propagates as 503, not 200', async () => {
    mocks.resolveRequestViewer.mockRejectedValue(httpError(503, 'SESSION_UNAVAILABLE'))
    expect((await get()).status).toBe(503)
    expect((await post(heartbeat())).status).toBe(503)
  })
})

describe('FR-141 POST — validation and Business ownership', () => {
  beforeEach(() => as(ownerA))

  it('rejects a non-JSON body with 400', async () => {
    const res = await post('this is not json')
    expect(res.status).toBe(400)
    expect((await (await get()).json()).count).toBe(0)
  })

  it('rejects an empty object with 400 and registers no default device', async () => {
    const res = await post({})
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Validation failed')
    expect(body.issues.join(' ')).toMatch(/deviceId/)
    expect(body.issues.join(' ')).toMatch(/businessId/)
    const list = await (await get()).json()
    expect(list.count).toBe(0)
    expect(JSON.stringify(list)).not.toContain('DEV-SMARTGIFT-PRIMARY')
  })

  it('rejects an unknown status with 400', async () => {
    expect((await post(heartbeat({ status: 'sleepy' }))).status).toBe(400)
    expect((await (await get()).json()).count).toBe(0)
  })

  it('refuses a Business the viewer sees but does not own with 403', async () => {
    as(seesAOnly)
    const res = await post(heartbeat({ businessId: 'business-a' }))
    expect(res.status).toBe(403)
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    as(ownerA)
    expect((await (await get()).json()).count).toBe(0)
  })

  it('acknowledges a valid heartbeat, lists it online, and never stores or echoes the token', async () => {
    const res = await post(heartbeat())
    expect(res.status).toBe(200)
    const ack = await res.json()
    expect(ack).toMatchObject({ acknowledged: true, businessId: 'business-a', deviceId: 'DEV-A-1', status: 'healthy', online: true, registered: true })
    expect(JSON.stringify(ack)).not.toContain(SECRET)

    const list = await (await get()).json()
    expect(list.count).toBe(1)
    expect(list.activeOnline).toBe(1)
    expect(list.devices[0]).toMatchObject({ businessId: 'business-a', deviceId: 'DEV-A-1', online: true, engine: 'zuri-edge-runtime', registeredBy: 'per-a' })
    expect(list.devices[0]).not.toHaveProperty('deviceToken')
    expect(JSON.stringify(list)).not.toContain(SECRET)
  })

  it('audits first registration and status transitions only — a no-change tick writes nothing', async () => {
    await post(heartbeat())
    expect(auditActions()).toEqual(['REGISTERED'])
    const [[first]] = mocks.auditCreate.mock.calls
    expect(first.data).toMatchObject({ entityType: 'EDGE_DEVICE', entityId: 'DEV-A-1', actorId: 'per-a' })
    expect(first.data.payloadJson).toContain('business-a')
    expect(first.data.payloadJson).not.toContain(SECRET)

    await post(heartbeat())
    expect(auditActions()).toEqual(['REGISTERED'])

    const degraded = await (await post(heartbeat({ status: 'degraded' }))).json()
    expect(degraded).toMatchObject({ online: false, registered: false })
    expect(auditActions()).toEqual(['REGISTERED', 'STATUS_CHANGED'])
    const list = await (await get()).json()
    expect(list.activeOnline).toBe(0)
    expect(list.devices[0].status).toBe('degraded')
  })

  it('a failed audit write is a 500, not an acknowledged heartbeat', async () => {
    mocks.auditCreate.mockRejectedValue(new Error('database unavailable'))
    const res = await post(heartbeat())
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/database unavailable/)
  })
})

describe('FR-141 GET — the registry is scoped to owned Businesses', () => {
  it("lists only the viewer's own devices and refuses another Business explicitly", async () => {
    as(ownerA)
    await post(heartbeat())
    as(ownerB)
    await post(heartbeat({ businessId: 'business-b', deviceId: 'DEV-B-1' }))

    as(ownerA)
    const a = await (await get()).json()
    expect(a.devices.map((d) => d.deviceId)).toEqual(['DEV-A-1'])

    as(ownerB)
    const b = await (await get()).json()
    expect(b.devices.map((d) => d.deviceId)).toEqual(['DEV-B-1'])
    expect((await get('?businessId=business-a')).status).toBe(403)

    as(seesAOnly)
    const s = await (await get()).json()
    expect(s.count).toBe(0)
    expect((await get('?businessId=business-a')).status).toBe(403)
  })

  it('marks a device offline once its last heartbeat is older than the window', async () => {
    vi.useFakeTimers({ now: new Date('2026-09-02T10:00:00Z') })
    as(ownerA)
    await post(heartbeat())
    expect((await (await get()).json()).activeOnline).toBe(1)
    vi.setSystemTime(new Date(Date.now() + EDGE_DEVICE_ONLINE_WINDOW_MS + 1_000))
    const list = await (await get()).json()
    expect(list.count).toBe(1)
    expect(list.activeOnline).toBe(0)
    expect(list.devices[0].online).toBe(false)
  })
})

describe('FR-141 DELETE — removal is scoped and audited', () => {
  beforeEach(async () => {
    as(ownerA)
    await post(heartbeat())
    await post(heartbeat({ deviceId: 'DEV-A-2' }))
    as(ownerB)
    await post(heartbeat({ businessId: 'business-b', deviceId: 'DEV-B-1' }))
    mocks.auditCreate.mockClear()
  })

  it('cannot remove a device that belongs to another Business', async () => {
    as(ownerB)
    expect((await del('?deviceId=DEV-A-1')).status).toBe(404)
    expect((await del('?businessId=business-a')).status).toBe(403)
    as(ownerA)
    expect((await (await get()).json()).count).toBe(2)
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('removes one owned device and audits it', async () => {
    as(ownerA)
    const res = await del('?deviceId=DEV-A-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ removed: [{ businessId: 'business-a', deviceId: 'DEV-A-1' }], remaining: 1 })
    expect(auditActions()).toEqual(['UNREGISTERED'])
    expect((await (await get()).json()).devices.map((d) => d.deviceId)).toEqual(['DEV-A-2'])
  })

  it("clearing without a deviceId clears exactly the viewer's owned scope", async () => {
    as(ownerB)
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ removed: [{ businessId: 'business-b', deviceId: 'DEV-B-1' }], remaining: 0 })
    as(ownerA)
    expect((await (await get()).json()).count).toBe(2)
  })
})

describe('FR-141 annotations name the requirement the route actually delivers', () => {
  it('the route cites FR-141 and this test, not FR-080, and has no default device or masked status', () => {
    const source = readFileSync('src/app/api/agent/heartbeat/route.js', 'utf8')
    expect(source).toMatch(/@req FR-141/)
    expect(source).toMatch(/@tested tests\/unit\/fr141-edge-device-heartbeat\.test\.js/)
    expect(source).not.toMatch(/FR-080/)
    expect(source).not.toContain('DEV-SMARTGIFT-PRIMARY')
    expect(source).not.toMatch(/status:\s*200/)
  })
})
