// @req FR-080 — heartbeat route contract kept working while the endpoint is
// re-secured; see the route file's header comment for why FR-080 itself does
// not describe this endpoint and which requirement is actually owed.
// @spec ADR-032, ADR-041, SEC-016 — every method requires a real viewer, and
// the in-memory registry is scoped by that viewer's Tenant(s).
// @tested tests/integration/agent-heartbeat-route.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { GET, POST, DELETE } from '@/app/api/agent/heartbeat/route'
import { generateSessionToken } from '@/modules/identity/auth-service'

const AUTH_SESSION_SECRET = 'agent-heartbeat-session-secret-that-is-long-enough-123456'

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

describe('Edge device heartbeat route (FR-080 route, tenant-scoped)', () => {
  let tenantA, businessA, ownerA
  let tenantB, businessB, ownerB

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `Heartbeat ${suffix}`, code: `PF-HB-${suffix}` })
    tenantA = await createTenant({ portfolioId: portfolio.id, name: `Heartbeat A ${suffix}`, code: `TNT-HBA-${suffix}` })
    tenantB = await createTenant({ portfolioId: portfolio.id, name: `Heartbeat B ${suffix}`, code: `TNT-HBB-${suffix}` })
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
    // ownerA can also *see* businessB (plain MEMBER) but never owns it — this is
    // the shape that must make GET show it and DELETE still refuse it.
    await prisma.membership.create({
      data: { personId: ownerA.id, tenantId: tenantB.id, businessId: businessB.id, role: 'MEMBER' },
    })
  })

  describe('GET', () => {
    it('refuses an unauthenticated request with a real status code, never an anonymous 200', async () => {
      const res = await GET(req('http://local/api/agent/heartbeat'))
      expect(res.status).toBe(401)
    })

    it('lists only devices behind the viewer\'s own Tenant(s), not another Tenant\'s', async () => {
      const deviceId = `DEV-HBA-${randomUUID().slice(0, 8)}`
      const postRes = await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST',
        cookie: sessionCookieFor(ownerA.id),
        body: { deviceId, businessId: businessA.id, status: 'healthy' },
      }))
      expect(postRes.status).toBe(200)

      // ownerB never sees Tenant A's device.
      const bRes = await GET(req('http://local/api/agent/heartbeat', { cookie: sessionCookieFor(ownerB.id) }))
      expect(bRes.status).toBe(200)
      const bJson = await bRes.json()
      expect(bJson.devices.some((d) => d.deviceId === deviceId)).toBe(false)

      // ownerA sees its own device.
      const aRes = await GET(req('http://local/api/agent/heartbeat', { cookie: sessionCookieFor(ownerA.id) }))
      const aJson = await aRes.json()
      expect(aJson.devices.some((d) => d.deviceId === deviceId)).toBe(true)
    })
  })

  describe('POST', () => {
    it('requires authentication', async () => {
      const res = await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST',
        body: { deviceId: 'DEV-ANON' },
      }))
      expect(res.status).toBe(401)
    })

    it('rejects a body with no deviceId as 400 instead of minting a default device', async () => {
      const res = await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST',
        cookie: sessionCookieFor(ownerA.id),
        body: { status: 'healthy' },
      }))
      expect(res.status).toBe(400)
      const before = await GET(req('http://local/api/agent/heartbeat', { cookie: sessionCookieFor(ownerA.id) }))
      const beforeJson = await before.json()
      expect(beforeJson.devices.some((d) => d.deviceId === 'DEV-SMARTGIFT-PRIMARY')).toBe(false)
    })

    it('rejects unparsable JSON as 400, not a swallowed 200', async () => {
      const badReq = new Request('http://local/api/agent/heartbeat', {
        method: 'POST',
        headers: { cookie: sessionCookieFor(ownerA.id), 'content-type': 'application/json' },
        body: '{not json',
      })
      const res = await POST(badReq)
      expect(res.status).toBe(400)
    })

    it('refuses to register a device against a Business the viewer does not own', async () => {
      const res = await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST',
        cookie: sessionCookieFor(ownerA.id),
        body: { deviceId: `DEV-X-${randomUUID().slice(0, 6)}`, businessId: businessB.id },
      }))
      expect(res.status).toBe(403)
    })

    it('defaults businessId to the viewer\'s own owned Business and records an audit event', async () => {
      const deviceId = `DEV-DEFAULT-${randomUUID().slice(0, 8)}`
      const res = await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST',
        cookie: sessionCookieFor(ownerB.id),
        body: { deviceId, status: 'degraded' },
      }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.deviceId).toBe(deviceId)

      const audit = await prisma.auditEvent.findFirst({
        where: { entityType: 'EdgeDevice', entityId: deviceId, action: 'EDGE_DEVICE_HEARTBEAT' },
        orderBy: { occurredAt: 'desc' },
      })
      expect(audit).not.toBeNull()
      expect(JSON.parse(audit.payloadJson)).toMatchObject({ tenantId: tenantB.id, businessId: businessB.id })
    })
  })

  describe('DELETE', () => {
    it('requires authentication', async () => {
      const res = await DELETE(req('http://local/api/agent/heartbeat?deviceId=whatever', { method: 'DELETE' }))
      expect(res.status).toBe(401)
    })

    it('answers 404 for a device in a Tenant the viewer merely sees but does not own', async () => {
      const deviceId = `DEV-SEEONLY-${randomUUID().slice(0, 8)}`
      await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST',
        cookie: sessionCookieFor(ownerB.id),
        body: { deviceId, businessId: businessB.id },
      }))
      // ownerA sees businessB (MEMBER) but does not own it.
      const res = await DELETE(req(`http://local/api/agent/heartbeat?deviceId=${deviceId}`, {
        method: 'DELETE',
        cookie: sessionCookieFor(ownerA.id),
      }))
      expect(res.status).toBe(404)

      // it is genuinely still there for its real owner.
      const stillThereRes = await GET(req('http://local/api/agent/heartbeat', { cookie: sessionCookieFor(ownerB.id) }))
      const stillThereJson = await stillThereRes.json()
      expect(stillThereJson.devices.some((d) => d.deviceId === deviceId)).toBe(true)
    })

    it('deletes a device the viewer owns the Tenant of, and audits it', async () => {
      const deviceId = `DEV-OWNED-${randomUUID().slice(0, 8)}`
      await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST',
        cookie: sessionCookieFor(ownerA.id),
        body: { deviceId, businessId: businessA.id },
      }))
      const res = await DELETE(req(`http://local/api/agent/heartbeat?deviceId=${deviceId}`, {
        method: 'DELETE',
        cookie: sessionCookieFor(ownerA.id),
      }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.deleted).toBe(deviceId)

      const audit = await prisma.auditEvent.findFirst({
        where: { entityType: 'EdgeDevice', entityId: deviceId, action: 'EDGE_DEVICE_REMOVED' },
      })
      expect(audit).not.toBeNull()
    })

    it('a bare clear-all removes only the caller\'s own Tenant devices, never another Tenant\'s', async () => {
      const deviceInA = `DEV-CLEARA-${randomUUID().slice(0, 8)}`
      const deviceInB = `DEV-CLEARB-${randomUUID().slice(0, 8)}`
      await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST', cookie: sessionCookieFor(ownerA.id), body: { deviceId: deviceInA, businessId: businessA.id },
      }))
      await POST(req('http://local/api/agent/heartbeat', {
        method: 'POST', cookie: sessionCookieFor(ownerB.id), body: { deviceId: deviceInB, businessId: businessB.id },
      }))

      const res = await DELETE(req('http://local/api/agent/heartbeat', { method: 'DELETE', cookie: sessionCookieFor(ownerA.id) }))
      expect(res.status).toBe(200)

      const aListRes = await GET(req('http://local/api/agent/heartbeat', { cookie: sessionCookieFor(ownerA.id) }))
      const aList = await aListRes.json()
      expect(aList.devices.some((d) => d.deviceId === deviceInA)).toBe(false)

      const bListRes = await GET(req('http://local/api/agent/heartbeat', { cookie: sessionCookieFor(ownerB.id) }))
      const bList = await bListRes.json()
      expect(bList.devices.some((d) => d.deviceId === deviceInB)).toBe(true)
    })
  })
})
