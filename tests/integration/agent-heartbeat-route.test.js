// @req FR-141 — the Edge Device heartbeat route resolves a trusted viewer on
// every method, scopes the registry to owned Businesses, rejects a bad payload
// with 400 instead of registering a default device, never persists or echoes
// the device token, and returns real status codes. Proven here through a real
// SQLite test db, real Membership rows and a real session cookie — the
// mocked-viewer contract lives in tests/unit/fr141-edge-device-heartbeat.test.js.
// @spec ADR-041 D3, SEC-001, SEC-008
// @tested tests/integration/agent-heartbeat-route.test.js
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { GET, POST, DELETE } from '@/app/api/agent/heartbeat/route'
import { generateSessionToken } from '@/modules/identity/auth-service'
import { resetEdgeDeviceRegistry } from '@/modules/agent/edge-device-registry'

const AUTH_SESSION_SECRET = 'agent-heartbeat-session-secret-that-is-long-enough-123456'
const SECRET = 'tok_edge_smartgift_secret'

async function ensurePerson(code, label) {
  process.env.ZURI_SESSION_SECRET = AUTH_SESSION_SECRET
  return prisma.person.upsert({
    where: { code },
    update: {},
    create: { code, displayName: label, email: `${code.toLowerCase()}@example.test` },
  })
}

function sessionCookieFor(personId) {
  return `zuri_session=${generateSessionToken(personId, { secret: AUTH_SESSION_SECRET })}`
}

function req(url, { method = 'GET', body, cookie } = {}) {
  return new Request(url, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const get = (qs = '', cookie) => GET(req(`http://local/api/agent/heartbeat${qs}`, { cookie }))
const del = (qs = '', cookie) => DELETE(req(`http://local/api/agent/heartbeat${qs}`, { method: 'DELETE', cookie }))
const post = (body, cookie) => POST(req('http://local/api/agent/heartbeat', { method: 'POST', body, cookie }))

const newId = (prefix) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`

describe('Edge device heartbeat route (FR-141, real session + real Membership rows)', () => {
  let businessA, ownerA, businessB, ownerB

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `Heartbeat ${suffix}`, code: `PF-HB-${suffix}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `Heartbeat A ${suffix}`, code: `TNT-HBA-${suffix}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `Heartbeat B ${suffix}`, code: `TNT-HBB-${suffix}` })
    businessA = await createBusiness({ tenantId: tenantA.id, name: `Heartbeat Biz A ${suffix}`, code: `BUS-HBA-${suffix}` })
    businessB = await createBusiness({ tenantId: tenantB.id, name: `Heartbeat Biz B ${suffix}`, code: `BUS-HBB-${suffix}` })

    ownerA = await ensurePerson(`PER-HBA-${suffix}`, 'Heartbeat Owner A')
    ownerB = await ensurePerson(`PER-HBB-${suffix}`, 'Heartbeat Owner B')

    await prisma.membership.create({
      data: { personId: ownerA.id, tenantId: tenantA.id, businessId: businessA.id, role: 'OWNER' },
    })
    await prisma.membership.create({
      data: { personId: ownerB.id, tenantId: tenantB.id, businessId: businessB.id, role: 'OWNER' },
    })
    // ownerA also *sees* businessB (plain MEMBER) but never owns it — this is
    // the shape that must make GET narrow correctly and DELETE/POST still
    // refuse it (403/404), never treat "visible" as "owned".
    await prisma.membership.create({
      data: { personId: ownerA.id, tenantId: tenantB.id, businessId: businessB.id, role: 'MEMBER' },
    })
  })

  // The registry is a process-local Map (by design — see edge-device-registry.js);
  // resetting it before each test keeps liveness state isolated the same way the
  // FR-141 unit test does, while real Person/Membership/AuditEvent rows stay in
  // the shared db and are told apart by fresh randomUUID device ids per test.
  beforeEach(() => {
    resetEdgeDeviceRegistry()
  })

  const heartbeat = (over = {}) => ({
    businessId: businessA.id,
    deviceId: newId('DEV-A'),
    status: 'healthy',
    deviceToken: SECRET,
    registeredQueries: ['sales.daily'],
    engine: 'zuri-edge-runtime',
    ...over,
  })

  describe('authentication fails closed on every method', () => {
    it('GET without a session cookie is 401, never an anonymous device list', async () => {
      const res = await get()
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body).not.toHaveProperty('devices')
    })

    it('POST without a session cookie is 401 and registers nothing', async () => {
      const body = heartbeat()
      const res = await post(body)
      expect(res.status).toBe(401)

      const list = await (await get('', sessionCookieFor(ownerA.id))).json()
      expect(list.devices.some((d) => d.deviceId === body.deviceId)).toBe(false)
    })

    it('DELETE without a session cookie is 401', async () => {
      const res = await del('?deviceId=whatever')
      expect(res.status).toBe(401)
    })
  })

  describe('POST — validation and Business ownership', () => {
    it('rejects unparsable JSON as 400, not a swallowed 200', async () => {
      const badReq = new Request('http://local/api/agent/heartbeat', {
        method: 'POST',
        headers: { cookie: sessionCookieFor(ownerA.id), 'content-type': 'application/json' },
        body: '{not json',
      })
      const res = await POST(badReq)
      expect(res.status).toBe(400)
    })

    it('rejects a body missing businessId as 400 and registers no default device', async () => {
      const deviceId = newId('DEV-NOBIZ')
      const res = await post({ deviceId, status: 'healthy' }, sessionCookieFor(ownerA.id))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Validation failed')
      expect(body.issues.join(' ')).toMatch(/businessId/)

      const list = await (await get('', sessionCookieFor(ownerA.id))).json()
      expect(list.devices.some((d) => d.deviceId === deviceId)).toBe(false)
    })

    it('rejects a body missing deviceId as 400', async () => {
      const res = await post({ businessId: businessA.id, status: 'healthy' }, sessionCookieFor(ownerA.id))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.issues.join(' ')).toMatch(/deviceId/)
    })

    it('refuses to register a device against a Business the viewer does not own', async () => {
      const deviceId = newId('DEV-X')
      const res = await post(heartbeat({ businessId: businessB.id, deviceId }), sessionCookieFor(ownerA.id))
      expect(res.status).toBe(403)

      const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'EDGE_DEVICE', entityId: deviceId } })
      expect(audit).toBeNull()
    })

    it('acknowledges a valid heartbeat, lists it under the owning Business, and never stores or echoes the token', async () => {
      const deviceId = newId('DEV-OK')
      const res = await post(heartbeat({ deviceId }), sessionCookieFor(ownerA.id))
      expect(res.status).toBe(200)
      const ack = await res.json()
      expect(ack).toMatchObject({
        acknowledged: true,
        businessId: businessA.id,
        deviceId,
        status: 'healthy',
        online: true,
        registered: true,
      })
      expect(JSON.stringify(ack)).not.toContain(SECRET)

      const list = await (await get('', sessionCookieFor(ownerA.id))).json()
      const device = list.devices.find((d) => d.deviceId === deviceId)
      expect(device).toMatchObject({ businessId: businessA.id, online: true, engine: 'zuri-edge-runtime' })
      expect(device).not.toHaveProperty('deviceToken')
      expect(JSON.stringify(list)).not.toContain(SECRET)

      const audit = await prisma.auditEvent.findFirst({
        where: { entityType: 'EDGE_DEVICE', entityId: deviceId, action: 'REGISTERED' },
      })
      expect(audit).not.toBeNull()
      expect(audit.actorId).toBe(ownerA.id)
      expect(audit.payloadJson).not.toContain(SECRET)
      expect(JSON.parse(audit.payloadJson)).toMatchObject({ businessId: businessA.id, status: 'healthy' })
    })

    it('defaults engine and model to null rather than fabricating a value', async () => {
      const deviceId = newId('DEV-BARE')
      const res = await post({ businessId: businessA.id, deviceId, status: 'healthy' }, sessionCookieFor(ownerA.id))
      expect(res.status).toBe(200)

      const list = await (await get('', sessionCookieFor(ownerA.id))).json()
      const device = list.devices.find((d) => d.deviceId === deviceId)
      expect(device.engine).toBeNull()
      expect(device.model).toBeNull()
    })

    it('audits first registration and status transitions only — a no-change tick writes nothing', async () => {
      const deviceId = newId('DEV-AUDIT')
      await post(heartbeat({ deviceId }), sessionCookieFor(ownerA.id))
      const afterFirst = await prisma.auditEvent.findMany({ where: { entityType: 'EDGE_DEVICE', entityId: deviceId } })
      expect(afterFirst.map((e) => e.action)).toEqual(['REGISTERED'])

      // an identical tick changes nothing and writes no audit row
      await post(heartbeat({ deviceId }), sessionCookieFor(ownerA.id))
      const afterRepeat = await prisma.auditEvent.findMany({ where: { entityType: 'EDGE_DEVICE', entityId: deviceId } })
      expect(afterRepeat.map((e) => e.action)).toEqual(['REGISTERED'])

      const degradedRes = await post(heartbeat({ deviceId, status: 'degraded' }), sessionCookieFor(ownerA.id))
      const degraded = await degradedRes.json()
      expect(degraded).toMatchObject({ online: false, registered: false })
      const afterTransition = await prisma.auditEvent.findMany({
        where: { entityType: 'EDGE_DEVICE', entityId: deviceId },
        orderBy: { occurredAt: 'asc' },
      })
      expect(afterTransition.map((e) => e.action)).toEqual(['REGISTERED', 'STATUS_CHANGED'])
    })
  })

  describe('GET — the registry is scoped to owned Businesses', () => {
    it("lists only the viewer's owned Business devices and 403s an explicit unowned businessId", async () => {
      const deviceA = newId('DEV-GA')
      const deviceB = newId('DEV-GB')
      await post(heartbeat({ deviceId: deviceA }), sessionCookieFor(ownerA.id))
      await post(heartbeat({ businessId: businessB.id, deviceId: deviceB }), sessionCookieFor(ownerB.id))

      const aList = await (await get('', sessionCookieFor(ownerA.id))).json()
      expect(aList.devices.some((d) => d.deviceId === deviceA)).toBe(true)
      expect(aList.devices.some((d) => d.deviceId === deviceB)).toBe(false)

      const bList = await (await get('', sessionCookieFor(ownerB.id))).json()
      expect(bList.devices.some((d) => d.deviceId === deviceB)).toBe(true)
      expect(bList.devices.some((d) => d.deviceId === deviceA)).toBe(false)

      // ownerA sees businessB (MEMBER) but does not own it: narrowing GET to it is 403.
      expect((await get(`?businessId=${businessB.id}`, sessionCookieFor(ownerA.id))).status).toBe(403)
    })

    it('never returns a viewerId — identity is implicit in the owned scope, not echoed back', async () => {
      await post(heartbeat(), sessionCookieFor(ownerA.id))
      const body = await (await get('', sessionCookieFor(ownerA.id))).json()
      expect(body).not.toHaveProperty('viewerId')
    })
  })

  describe('DELETE — removal is scoped to owned Businesses and audited', () => {
    it('cannot remove a device that belongs to a Business the viewer merely sees (MEMBER, not OWNER) — 404', async () => {
      const deviceId = newId('DEV-SEEONLY')
      await post(heartbeat({ businessId: businessB.id, deviceId }), sessionCookieFor(ownerB.id))

      // ownerA sees businessB (MEMBER) but does not own it.
      const res = await del(`?deviceId=${deviceId}`, sessionCookieFor(ownerA.id))
      expect(res.status).toBe(404)

      // narrowing explicitly by the unowned businessId is 403, not 404.
      expect((await del(`?businessId=${businessB.id}`, sessionCookieFor(ownerA.id))).status).toBe(403)

      // it is genuinely still there for its real owner.
      const stillThere = await (await get('', sessionCookieFor(ownerB.id))).json()
      expect(stillThere.devices.some((d) => d.deviceId === deviceId)).toBe(true)
    })

    it('removes one owned device, returns the new contract shape, and audits UNREGISTERED', async () => {
      const deviceId = newId('DEV-REMOVE')
      await post(heartbeat({ deviceId }), sessionCookieFor(ownerA.id))

      const res = await del(`?deviceId=${deviceId}`, sessionCookieFor(ownerA.id))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ removed: [{ businessId: businessA.id, deviceId }], remaining: 0 })

      const list = await (await get('', sessionCookieFor(ownerA.id))).json()
      expect(list.devices.some((d) => d.deviceId === deviceId)).toBe(false)

      const audit = await prisma.auditEvent.findFirst({
        where: { entityType: 'EDGE_DEVICE', entityId: deviceId, action: 'UNREGISTERED' },
      })
      expect(audit).not.toBeNull()
    })

    it("clearing without a deviceId clears exactly the caller's owned scope, never another owner's", async () => {
      const deviceInA = newId('DEV-CLEARA')
      const deviceInB = newId('DEV-CLEARB')
      await post(heartbeat({ deviceId: deviceInA }), sessionCookieFor(ownerA.id))
      await post(heartbeat({ businessId: businessB.id, deviceId: deviceInB }), sessionCookieFor(ownerB.id))

      const res = await del('', sessionCookieFor(ownerA.id))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ removed: [{ businessId: businessA.id, deviceId: deviceInA }], remaining: 0 })

      const aList = await (await get('', sessionCookieFor(ownerA.id))).json()
      expect(aList.count).toBe(0)

      const bList = await (await get('', sessionCookieFor(ownerB.id))).json()
      expect(bList.devices.some((d) => d.deviceId === deviceInB)).toBe(true)
    })
  })
})
