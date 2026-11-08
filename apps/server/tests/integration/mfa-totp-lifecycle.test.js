import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { generateTotp, generateTotpSecret } from '@/modules/identity/totp'
import { openMfaSecret } from '@/modules/identity/mfa-secret-seal'
import { resealMfaFactorSecrets } from '@/modules/identity/mfa-secret-reseal'
import { assertSessionAssurance, elevateSession, resolveSessionAssurance } from '@/modules/identity/session-assurance'
import { POST as postEnrollTotp } from '@/app/api/auth/mfa/totp/enroll/route'
import { POST as postVerifyTotp } from '@/app/api/auth/mfa/totp/verify/route'
import { DELETE as deleteFactor, GET as getFactors } from '@/app/api/auth/mfa/factors/route'
import { POST as postStepUp } from '@/app/api/auth/step-up/route'

// @req FR-094, FR-095, FR-096 — multi-factor authentication lifecycle
// @spec ADR-045 D2, D4, D5, SDD-052, SEC-018, SEC-029, SDD-096, ADR-088
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

async function createPasswordSessionViewer(prefix) {
  const suffix = randomUUID()
  const person = await prisma.person.create({
    data: { code: `${prefix}-${suffix.slice(0, 8)}`, displayName: `${prefix} User` },
  })
  const session = await prisma.session.create({
    data: {
      personId: person.id,
      tokenHash: `${prefix}-${suffix}`,
      status: 'ACTIVE',
      assurance: 'PASSWORD',
      assuranceLevel: 'AAL1',
      expiresAt: new Date(Date.now() + 86400000),
    },
  })
  const viewer = makeViewer({
    principal: { id: person.id, code: person.code, displayName: person.displayName },
    role: 'OWNER',
    visibleBusinessIds: [business.id],
    ownedBusinessIds: [business.id],
    ownedTenantIds: [tenant.id],
    visibleDomains: ['identity', 'platform'],
  })
  viewer.personId = person.id
  return { person, session, viewer }
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
      assurance: 'PASSWORD',
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
    expect(resolveSessionAssurance(staffSession)).toBe('AAL1')
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

    // SEC-029: the column holds a sealed value, never the base32 secret the app showed
    expect(factorInDb.secret).not.toBe(data.secret)
    expect(factorInDb.secret).not.toContain(data.secret)
    expect(factorInDb.secret).toMatch(/^mfa\.v\d+\./)
    expect(openMfaSecret(factorInDb.secret, { personId: staffPerson.id, factorId: enrolledFactorId })).toBe(data.secret)
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

  it('confirms the first factor at AAL1 and elevates only for the live window', async () => {
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
    expect(sessionInDb.assuranceLevel).toBe('AAL1')
    expect(new Date(sessionInDb.elevatedUntil).getTime() - Date.now()).toBeLessThanOrEqual(900_000)
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
      body: { code: validCode, ttlSeconds: 31536000 },
    })
    const stepUpStartedAt = Date.now()
    const res = await postStepUp(req, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    const stepUpFinishedAt = Date.now()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.elevated).toBe(true)
    expect(data.assuranceLevel).toBe('AAL2')
    expect(data.elevatedUntil).toBeTruthy()
    // The server stamps now + 900 s somewhere between start and finish; the
    // client's one-year ttlSeconds must not stretch it.
    const elevatedUntilMs = new Date(data.elevatedUntil).getTime()
    expect(elevatedUntilMs).toBeLessThanOrEqual(stepUpFinishedAt + 900_000)
    expect(elevatedUntilMs).toBeGreaterThanOrEqual(stepUpStartedAt + 900_000)

    // Assert session assurance now succeeds for AAL2
    const elevatedSession = await prisma.session.findUnique({ where: { id: staffSession.id } })
    expect(elevatedSession.assuranceLevel).toBe('AAL1')
    expect(resolveSessionAssurance(elevatedSession)).toBe('AAL2')
    expect(assertSessionAssurance(elevatedSession, 'AAL2')).toBe(true)
  })

  it('blocks password-only factor replacement and deletion until a live step-up', async () => {
    const staleUntil = new Date(Date.now() - 5000)
    await prisma.session.update({
      where: { id: staffSession.id },
      data: { assurance: 'PASSWORD', assuranceLevel: 'AAL2', elevatedUntil: staleUntil },
    })
    const staleSession = await prisma.session.findUnique({ where: { id: staffSession.id } })
    expect(resolveSessionAssurance(staleSession)).toBe('AAL1')

    const beforeCount = await prisma.mfaFactor.count({ where: { personId: staffPerson.id } })
    const enrollReq = mockRequest('http://localhost:3000/api/auth/mfa/totp/enroll', {
      method: 'POST',
      body: {},
    })
    const refusedEnroll = await postEnrollTotp(enrollReq, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(refusedEnroll.status).toBe(403)
    expect((await refusedEnroll.json()).error).toBe('ASSURANCE_LEVEL_INSUFFICIENT')
    expect(await prisma.mfaFactor.count({ where: { personId: staffPerson.id } })).toBe(beforeCount)

    const deleteReq = mockRequest('http://localhost:3000/api/auth/mfa/factors', {
      method: 'DELETE',
      body: { factorId: enrolledFactorId },
    })
    const refusedDelete = await deleteFactor(deleteReq, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(refusedDelete.status).toBe(403)
    expect((await refusedDelete.json()).error).toBe('ASSURANCE_LEVEL_INSUFFICIENT')
    expect((await prisma.mfaFactor.findUnique({ where: { id: enrolledFactorId } })).status).toBe('ACTIVE')

    const liveStepUpReq = mockRequest('http://localhost:3000/api/auth/step-up', {
      method: 'POST',
      body: { code: generateTotp({ secret: enrolledSecret }) },
    })
    const liveStepUp = await postStepUp(liveStepUpReq, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(liveStepUp.status).toBe(200)

    const allowedEnroll = await postEnrollTotp(enrollReq, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(allowedEnroll.status).toBe(200)
    expect(await prisma.mfaFactor.count({ where: { personId: staffPerson.id } })).toBe(beforeCount + 1)
  })

  it('revokes an MFA factor and rejects subsequent step-up', async () => {
    const req = mockRequest('http://localhost:3000/api/auth/mfa/factors', {
      method: 'DELETE',
      body: { factorId: enrolledFactorId },
    })
    const res = await deleteFactor(req, { viewer: staffViewer, tokenHash: staffSession.tokenHash })
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

describe('session elevation is bound to one live Person session', () => {
  it('rejects a token hash that belongs to another Person without updating it', async () => {
    const { person, session } = await createPasswordSessionViewer('PSN-ELEVATE-OWNER')
    const { person: otherPerson } = await createPasswordSessionViewer('PSN-ELEVATE-OTHER')
    const before = await prisma.session.findUnique({ where: { id: session.id } })

    await expect(elevateSession({ tokenHash: session.tokenHash, personId: otherPerson.id }))
      .rejects.toMatchObject({ status: 401, message: 'ACTIVE_SESSION_REQUIRED' })

    const after = await prisma.session.findUnique({ where: { id: session.id } })
    expect(after.elevatedUntil).toBeNull()
    expect(after.version).toBe(before.version)
    expect(after.personId).toBe(person.id)
  })

  it('rejects an expired session without updating it', async () => {
    const { person, session } = await createPasswordSessionViewer('PSN-ELEVATE-EXPIRED')
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    await expect(elevateSession({ tokenHash: session.tokenHash, personId: person.id }))
      .rejects.toMatchObject({ status: 401, message: 'ACTIVE_SESSION_REQUIRED' })

    const after = await prisma.session.findUnique({ where: { id: session.id } })
    expect(after.elevatedUntil).toBeNull()
  })

  it('rejects a revoked session without updating it', async () => {
    const { person, session } = await createPasswordSessionViewer('PSN-ELEVATE-REVOKED')
    await prisma.session.update({
      where: { id: session.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    })

    await expect(elevateSession({ tokenHash: session.tokenHash, personId: person.id }))
      .rejects.toMatchObject({ status: 401, message: 'ACTIVE_SESSION_REQUIRED' })

    const after = await prisma.session.findUnique({ where: { id: session.id } })
    expect(after.elevatedUntil).toBeNull()
  })
})

describe('factor enrollment confirmation rechecks current factors', () => {
  it('refuses an AAL1 confirmation if an ACTIVE factor appeared after enrollment started', async () => {
    const { person, session, viewer } = await createPasswordSessionViewer('PSN-MFA-CONFIRM')
    const startReq = mockRequest('http://localhost:3000/api/auth/mfa/totp/enroll', {
      method: 'POST',
      body: {},
    })
    const started = await postEnrollTotp(startReq, { viewer, tokenHash: session.tokenHash })
    expect(started.status).toBe(200)
    const { factorId, secret } = await started.json()

    await prisma.mfaFactor.create({
      data: {
        personId: person.id,
        type: 'TOTP',
        secret: 'mfa.v0.active-factor-placeholder.value',
        status: 'ACTIVE',
        verifiedAt: new Date(),
      },
    })

    const verifyReq = mockRequest('http://localhost:3000/api/auth/mfa/totp/verify', {
      method: 'POST',
      body: { factorId, code: generateTotp({ secret }) },
    })
    const refused = await postVerifyTotp(verifyReq, { viewer, tokenHash: session.tokenHash })
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toBe('ASSURANCE_LEVEL_INSUFFICIENT')
    expect((await prisma.mfaFactor.findUnique({ where: { id: factorId } })).status).toBe('PENDING')
  })
})

describe('SEC-029 — factor secrets sealed at rest, and the sweep for rows written before', () => {
  let person
  let session
  let viewer

  beforeAll(async () => {
    person = await prisma.person.create({
      data: { code: 'PSN-MFA-LEGACY', displayName: 'MFA Legacy User', email: 'legacy.mfa@zuri.ai' },
    })
    session = await prisma.session.create({
      data: {
        personId: person.id,
        tokenHash: 'mfa-test-session-hash-legacy',
        status: 'ACTIVE',
        assuranceLevel: 'AAL1',
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    viewer = makeViewer({
      principal: { id: person.id, code: person.code, displayName: person.displayName },
      role: 'OWNER',
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      ownedTenantIds: [tenant.id],
      visibleDomains: ['identity', 'platform'],
    })
    viewer.personId = person.id
  })

  function stepUp(code) {
    const req = mockRequest('http://localhost:3000/api/auth/step-up', { method: 'POST', body: { code } })
    return postStepUp(req, { viewer, tokenHash: session.tokenHash })
  }

  it('a plaintext factor left by an earlier release fails closed until the sweep seals it, then verifies unchanged', async () => {
    const legacySecret = generateTotpSecret()
    const legacy = await prisma.mfaFactor.create({
      data: { personId: person.id, type: 'TOTP', secret: legacySecret, status: 'ACTIVE', verifiedAt: new Date() },
    })

    expect((await stepUp(generateTotp({ secret: legacySecret }))).status).toBe(401)

    const dryRun = await resealMfaFactorSecrets()
    expect(dryRun.pending.find(p => p.factorId === legacy.id)).toMatchObject({ from: 'LEGACY_PLAINTEXT', status: 'ACTIVE' })
    expect((await prisma.mfaFactor.findUnique({ where: { id: legacy.id } })).secret).toBe(legacySecret)

    const written = await resealMfaFactorSecrets({ write: true })
    expect(written.resealed).toContain(legacy.id)

    const sealed = await prisma.mfaFactor.findUnique({ where: { id: legacy.id } })
    expect(sealed.secret).not.toContain(legacySecret)
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'MFA_FACTOR', entityId: legacy.id, action: 'SECRET_RESEALED' } })
    expect(audit).toBeTruthy()
    expect(audit.payloadJson).not.toContain(legacySecret)

    // The same authenticator entry the person already has keeps working
    const res = await stepUp(generateTotp({ secret: legacySecret }))
    expect(res.status).toBe(200)
    expect((await res.json()).elevated).toBe(true)

    const again = await resealMfaFactorSecrets({ write: true })
    expect(again.pending.map(p => p.factorId)).not.toContain(legacy.id)
    expect(again.resealed).not.toContain(legacy.id)
  })

  it("a sealed secret copied onto another Person's factor does not verify for them", async () => {
    const other = await prisma.person.create({ data: { code: 'PSN-MFA-OTHER', displayName: 'MFA Other User' } })
    const enrollReq = mockRequest('http://localhost:3000/api/auth/mfa/totp/enroll', { method: 'POST', body: {} })
    const otherViewer = makeViewer({
      principal: { id: other.id, code: other.code, displayName: other.displayName },
      role: 'OWNER',
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      ownedTenantIds: [tenant.id],
      visibleDomains: ['identity', 'platform'],
    })
    otherViewer.personId = other.id
    const { secret: otherSecret, factorId: otherFactorId } = await (await postEnrollTotp(enrollReq, { viewer: otherViewer })).json()
    const otherRow = await prisma.mfaFactor.findUnique({ where: { id: otherFactorId } })

    await prisma.mfaFactor.updateMany({ where: { personId: person.id }, data: { status: 'REVOKED' } })
    await prisma.mfaFactor.create({
      data: { personId: person.id, type: 'TOTP', secret: otherRow.secret, status: 'ACTIVE', verifiedAt: new Date() },
    })

    expect((await stepUp(generateTotp({ secret: otherSecret }))).status).toBe(401)
  })
})
