import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { generateTotp } from '@/modules/identity/totp'
import { assertSessionAssurance, resolveSessionAssurance } from '@/modules/identity/session-assurance'
import { POST as postEnrollTotp } from '@/app/api/auth/mfa/totp/enroll/route'
import { POST as postVerifyTotp } from '@/app/api/auth/mfa/totp/verify/route'
import { DELETE as deleteFactor, GET as getFactors } from '@/app/api/auth/mfa/factors/route'
import { POST as postStepUp } from '@/app/api/auth/step-up/route'

// @req FR-094, FR-095, FR-096 — multi-factor authentication lifecycle
// @spec ADR-045 D2, D4, D5, SDD-052, SEC-018
// @tested tests/integration/mfa-totp-lifecycle.test.js

let tenant
let business
let staffPerson
let staffViewer
let staffSession

function mockRequest(url, { method = 'GET', body = null, headers = {} } = {}) {
  return {
    url,
    method,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? headers[name] ?? null,
    },
    json: async () => body ?? {},
  }
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'MFA Group', code: 'PF-MFA-P2' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'MFA Tenant', code: 'TNT-MFA-P2' })
  business = await createBusiness({ tenantId: tenant.id, name: 'MFA Business', code: 'BUS-MFA-P2' })

  staffPerson = await prisma.person.create({
    data: {
      code: 'PSN-MFA-STAFF',
      displayName: 'MFA Staff User',
      email: 'staff.mfa@zuri.ai',
    },
  })

  await prisma.membership.create({
    data: {
      personId: staffPerson.id,
      tenantId: tenant.id,
      businessId: business.id,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  })

  staffSession = await prisma.session.create({
    data: {
      personId: staffPerson.id,
      tokenHash: 'mfa-test-session-hash-1',
      status: 'ACTIVE',
      assuranceLevel: 'AAL1',
      expiresAt: new Date(Date.now() + 86400000),
    },
  })

  staffViewer = makeViewer({
    principal: { id: staffPerson.id, code: staffPerson.code, displayName: staffPerson.displayName },
    role: 'OWNER',
    visibleBusinessIds: [business.id],
    ownedBusinessIds: [business.id],
    ownedTenantIds: [tenant.id],
    visibleDomains: ['identity', 'platform'],
  })
  staffViewer.personId = staffPerson.id
  staffViewer.tenantId = tenant.id
  staffViewer.session = staffSession
})

describe('P2 Enterprise IAM — MFA TOTP & Session Assurance Lifecycle', () => {
  let enrolledFactorId
  let enrolledSecret

  it('enrolls a pending TOTP factor and returns secret and uri', async () => {
    const req = mockRequest('http://localhost:3000/api/auth/mfa/totp/enroll', {
      method: 'POST',
      body: { label: 'My Google Authenticator' },
    })
    const res = await postEnrollTotp(req, { viewer: staffViewer })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.factorId).toBeTruthy()
    expect(data.secret).toBeTruthy()
    expect(data.uri).toContain('otpauth://totp/')
    expect(data.uri).toContain('staff.mfa%40zuri.ai')

    enrolledFactorId = data.factorId
    enrolledSecret = data.secret

    // Factor is in PENDING state in DB
    const factorInDb = await prisma.mfaFactor.findUnique({ where: { id: enrolledFactorId } })
    expect(factorInDb.status).toBe('PENDING')
    expect(factorInDb.verifiedAt).toBeNull()
  })

  it('lists registered factors without leaking raw secret', async () => {
    const req = mockRequest('http://localhost:3000/api/auth/mfa/factors')
    const res = await getFactors(req, { viewer: staffViewer })
    expect(res.status).toBe(200)

    const { factors } = await res.json()
    expect(factors.length).toBeGreaterThanOrEqual(1)
    const factor = factors.find((f) => f.id === enrolledFactorId)
    expect(factor).toBeTruthy()
    expect(factor.status).toBe('PENDING')
    expect(factor.secret).toBeUndefined()
  })

  it('rejects confirmation with invalid TOTP code', async () => {
    const req = mockRequest('http://localhost:3000/api/auth/mfa/totp/verify', {
      method: 'POST',
      body: { factorId: enrolledFactorId, code: '000000' },
    })
    const res = await postVerifyTotp(req, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(res.status).toBe(400)
    const err = await res.json()
    expect(err.error).toMatch(/INVALID_MFA_CODE/i)
  })

  it('confirms enrollment with valid code, activates factor, and elevates session to AAL2', async () => {
    const validCode = generateTotp({ secret: enrolledSecret })
    const req = mockRequest('http://localhost:3000/api/auth/mfa/totp/verify', {
      method: 'POST',
      body: { factorId: enrolledFactorId, code: validCode },
    })
    const res = await postVerifyTotp(req, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.status).toBe('ACTIVE')
    expect(data.assuranceLevel).toBe('AAL2')

    // Verify DB state
    const factorInDb = await prisma.mfaFactor.findUnique({ where: { id: enrolledFactorId } })
    expect(factorInDb.status).toBe('ACTIVE')
    expect(factorInDb.verifiedAt).toBeTruthy()

    // Verify Session is elevated
    const sessionInDb = await prisma.session.findUnique({ where: { id: staffSession.id } })
    expect(sessionInDb.assuranceLevel).toBe('AAL2')
    expect(resolveSessionAssurance(sessionInDb)).toBe('AAL2')
    expect(assertSessionAssurance(sessionInDb, 'AAL2')).toBe(true)
  })

  it('performs step-up authentication on an AAL1 session', async () => {
    // Demote session back to AAL1 to test step-up
    await prisma.session.update({
      where: { id: staffSession.id },
      data: { assuranceLevel: 'AAL1', elevatedUntil: null },
    })

    const initialSession = await prisma.session.findUnique({ where: { id: staffSession.id } })
    expect(resolveSessionAssurance(initialSession)).toBe('AAL1')
    expect(() => assertSessionAssurance(initialSession, 'AAL2')).toThrow(/ASSURANCE_LEVEL_INSUFFICIENT/)

    // Step-up with active TOTP factor
    const validCode = generateTotp({ secret: enrolledSecret })
    const req = mockRequest('http://localhost:3000/api/auth/step-up', {
      method: 'POST',
      body: { code: validCode, ttlSeconds: 600 },
    })
    const res = await postStepUp(req, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.elevated).toBe(true)
    expect(data.assuranceLevel).toBe('AAL2')
    expect(data.elevatedUntil).toBeTruthy()

    // Assert session assurance now succeeds for AAL2
    const elevatedSession = await prisma.session.findUnique({ where: { id: staffSession.id } })
    expect(resolveSessionAssurance(elevatedSession)).toBe('AAL2')
    expect(assertSessionAssurance(elevatedSession, 'AAL2')).toBe(true)
  })

  it('revokes an MFA factor and rejects subsequent step-up', async () => {
    const req = mockRequest('http://localhost:3000/api/auth/mfa/factors', {
      method: 'DELETE',
      body: { factorId: enrolledFactorId },
    })
    const res = await deleteFactor(req, { viewer: staffViewer })
    expect(res.status).toBe(200)

    const factorInDb = await prisma.mfaFactor.findUnique({ where: { id: enrolledFactorId } })
    expect(factorInDb.status).toBe('REVOKED')
    expect(factorInDb.revokedAt).toBeTruthy()

    // Step-up now fails because no active factor exists
    const validCode = generateTotp({ secret: enrolledSecret })
    const stepUpReq = mockRequest('http://localhost:3000/api/auth/step-up', {
      method: 'POST',
      body: { code: validCode },
    })
    const stepUpRes = await postStepUp(stepUpReq, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(stepUpRes.status).toBe(401)
  })
})
