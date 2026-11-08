import { beforeAll, describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { toBase64Url } from '@/modules/identity/webauthn'
import { POST as postRegisterOptions } from '@/app/api/auth/webauthn/register/options/route'
import { POST as postRegisterVerify } from '@/app/api/auth/webauthn/register/verify/route'
import { POST as postLoginOptions } from '@/app/api/auth/webauthn/login/options/route'
import { POST as postLoginVerify } from '@/app/api/auth/webauthn/login/verify/route'
import { DELETE as deletePasskey, GET as getPasskeys } from '@/app/api/auth/webauthn/credentials/route'
import { POST as postStepUp } from '@/app/api/auth/webauthn/step-up/route'
import { resolveSessionAssurance } from '@/modules/identity/session-assurance'
import { assertCredentialWriteAssurance } from '@/modules/identity/credential-write-gate'
import { AUTH_SESSION_COOKIE, hashSessionToken } from '@/modules/identity/auth-service'
import { POST as postEnrollTotp } from '@/app/api/auth/mfa/totp/enroll/route'
import { DELETE as deleteFactor } from '@/app/api/auth/mfa/factors/route'

// @req FR-094, FR-095, FR-096 — WebAuthn registration and live factor assurance
// @spec ADR-045 D2, D4, SEC-018
// @tested tests/integration/passkey-lifecycle.test.js

process.env.ZURI_SESSION_SECRET = process.env.ZURI_SESSION_SECRET || 'passkey-lifecycle-test-session-secret-0123456789'

function sha256(buf) {
  return createHash('sha256').update(buf).digest()
}

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

async function createPersonSessionViewer(prefix, { assurance = 'PASSWORD', elevatedUntil = null } = {}) {
  const suffix = randomUUID()
  const person = await prisma.person.create({
    data: {
      code: `${prefix}-${suffix.slice(0, 8)}`,
      displayName: `${prefix} User`,
    },
  })
  const session = await prisma.session.create({
    data: {
      personId: person.id,
      tokenHash: `${prefix}-${suffix}`,
      status: 'ACTIVE',
      assurance,
      assuranceLevel: assurance === 'WEBAUTHN' ? 'AAL2' : 'AAL1',
      elevatedUntil,
      expiresAt: new Date(Date.now() + 86400000),
    },
  })
  const viewer = makeViewer({
    role: 'MEMBER',
    principal: { id: person.id, code: person.code, displayName: person.displayName },
  })
  viewer.personId = person.id
  viewer.sessionTokenHash = session.tokenHash
  viewer.session = session
  return { person, session, viewer }
}

/**
 * Helper to build a valid CBOR-encoded attestation object for testing.
 */
function buildMockAttestationObject({ rpId = 'localhost', credentialId, publicKeyJwk }) {
  const rpIdHash = sha256(Buffer.from(rpId))
  const flags = Buffer.from([0x41]) // UP + AT
  const signCount = Buffer.alloc(4) // 0
  const aaguid = Buffer.alloc(16, 0xaa)

  const credIdBuf = Buffer.from(credentialId, 'utf8')
  const credIdLen = Buffer.alloc(2)
  credIdLen.writeUInt16BE(credIdBuf.length, 0)

  const xBuf = Buffer.from(publicKeyJwk.x, 'base64url')
  const yBuf = Buffer.from(publicKeyJwk.y, 'base64url')

  // COSE Key: map of 5 items
  const coseKey = Buffer.concat([
    Buffer.from([0xa5]),
    Buffer.from([0x01, 0x02]), // 1: 2 (kty: EC)
    Buffer.from([0x03, 0x26]), // 3: -7 (alg: ES256)
    Buffer.from([0x20, 0x01]), // -1: 1 (crv: P-256)
    Buffer.from([0x21, 0x58, 0x20]), xBuf, // -2: x (32 bytes)
    Buffer.from([0x22, 0x58, 0x20]), yBuf, // -3: y (32 bytes)
  ])

  const authData = Buffer.concat([
    rpIdHash,
    flags,
    signCount,
    aaguid,
    credIdLen,
    credIdBuf,
    coseKey,
  ])

  // attestationObject: map of 3 items (fmt: "none", attStmt: {}, authData: byte string)
  const authDataLenHeader = Buffer.alloc(3)
  authDataLenHeader[0] = 0x59 // byte string, 2-byte length
  authDataLenHeader.writeUInt16BE(authData.length, 1)

  const attestationObject = Buffer.concat([
    Buffer.from([0xa3]),
    Buffer.from([0x63, 0x66, 0x6d, 0x74, 0x64, 0x6e, 0x6f, 0x6e, 0x65]), // "fmt": "none"
    Buffer.from([0x67, 0x61, 0x74, 0x74, 0x53, 0x74, 0x6d, 0x74, 0xa0]), // "attStmt": {}
    Buffer.from([0x68, 0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61]), // "authData"
    authDataLenHeader,
    authData,
  ])

  return attestationObject
}

let tenant
let business
let staffPerson
let staffViewer
let staffSession
let keyPair
let jwk

beforeAll(async () => {
  keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  jwk = keyPair.publicKey.export({ format: 'jwk' })

  const portfolio = await createPortfolio({ name: 'Passkey Group', code: 'PF-PK-P2' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Passkey Tenant', code: 'TNT-PK-P2' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Passkey Business', code: 'BUS-PK-P2' })

  staffPerson = await prisma.person.create({
    data: {
      code: 'PSN-PK-STAFF',
      displayName: 'Passkey Staff User',
      email: 'staff.passkey@zuri.ai',
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
      tokenHash: 'pk-test-session-hash-1',
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
  staffViewer.sessionTokenHash = staffSession.tokenHash
})

describe('P2 Enterprise IAM — WebAuthn Passkey Lifecycle', () => {
  let registrationChallenge
  let registeredCredentialId
  let registeredPasskeyId

  it('generates registration options with challenge', async () => {
    const req = mockRequest('http://localhost:3000/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: { host: 'localhost:3000' },
    })
    const res = await postRegisterOptions(req, { viewer: staffViewer })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.options).toBeDefined()
    expect(data.options.challenge).toBeTruthy()
    expect(data.options.user.name).toBe('staff.passkey@zuri.ai')
    registrationChallenge = data.options.challenge
  })

  it('completes registration and creates PasskeyCredential in DB', async () => {
    const sessionCookie = `register-cookie-${randomUUID()}`
    const cookieSession = await prisma.session.create({
      data: {
        personId: staffPerson.id,
        tokenHash: hashSessionToken(sessionCookie),
        status: 'ACTIVE',
        assurance: 'PASSWORD',
        assuranceLevel: 'AAL1',
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    const { session: decoySession } = await createPersonSessionViewer('PK-REG-DECOY')

    const rawCredId = 'passkey-cred-test-1'
    registeredCredentialId = toBase64Url(Buffer.from(rawCredId))

    const attestationObject = buildMockAttestationObject({
      rpId: 'localhost',
      credentialId: rawCredId,
      publicKeyJwk: jwk,
    })

    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge: registrationChallenge,
      origin: 'http://localhost:3000',
    })

    const req = mockRequest('http://localhost:3000/api/auth/webauthn/register/verify', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        cookie: `${AUTH_SESSION_COOKIE}=${encodeURIComponent(sessionCookie)}`,
      },
      body: {
        credential: {
          id: registeredCredentialId,
          rawId: registeredCredentialId,
          response: {
            clientDataJSON: toBase64Url(Buffer.from(clientDataJSON)),
            attestationObject: toBase64Url(attestationObject),
          },
          type: 'public-key',
        },
        deviceLabel: 'MacBook TouchID',
      },
    })

    const res = await postRegisterVerify(req, { viewer: staffViewer, tokenHash: decoySession.tokenHash })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.passkeyId).toBeTruthy()
    expect(data.deviceLabel).toBe('MacBook TouchID')
    registeredPasskeyId = data.passkeyId

    // Verify persisted in database
    const inDb = await prisma.passkeyCredential.findUnique({
      where: { id: registeredPasskeyId },
    })
    expect(inDb).toBeTruthy()
    expect(inDb.status).toBe('ACTIVE')
    expect(inDb.personId).toBe(staffPerson.id)
    const elevatedSession = await prisma.session.findUnique({ where: { id: cookieSession.id } })
    expect(elevatedSession.assuranceLevel).toBe('AAL1')
    expect(resolveSessionAssurance(elevatedSession)).toBe('AAL2')
    expect(new Date(elevatedSession.elevatedUntil).getTime() - Date.now()).toBeLessThanOrEqual(900_000)
    const untouchedDecoy = await prisma.session.findUnique({ where: { id: decoySession.id } })
    expect(untouchedDecoy.elevatedUntil).toBeNull()
    const originalSession = await prisma.session.findUnique({ where: { id: staffSession.id } })
    expect(resolveSessionAssurance(originalSession)).toBe('AAL1')
  })

  it('lists registered passkeys for the viewer', async () => {
    const req = mockRequest('http://localhost:3000/api/auth/webauthn/credentials')
    const res = await getPasskeys(req, { viewer: staffViewer })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.passkeys.length).toBeGreaterThanOrEqual(1)
    const found = data.passkeys.find((p) => p.id === registeredPasskeyId)
    expect(found).toBeTruthy()
    expect(found.deviceLabel).toBe('MacBook TouchID')
  })

  it('requires live AAL2 before adding another passkey when a passkey factor is active', async () => {
    await prisma.session.update({
      where: { id: staffSession.id },
      data: {
        assurance: 'PASSWORD',
        assuranceLevel: 'AAL2',
        elevatedUntil: new Date(Date.now() - 5000),
      },
    })
    const beforeCount = await prisma.passkeyCredential.count({ where: { personId: staffPerson.id } })
    const request = mockRequest('http://localhost:3000/api/auth/webauthn/register/options', {
      method: 'POST',
      headers: { host: 'localhost:3000' },
    })
    const response = await postRegisterOptions(request, {
      viewer: staffViewer,
      tokenHash: staffSession.tokenHash,
    })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('ASSURANCE_LEVEL_INSUFFICIENT')
    expect(await prisma.passkeyCredential.count({ where: { personId: staffPerson.id } })).toBe(beforeCount)

    const deleteResponse = await deletePasskey(
      mockRequest(`http://localhost:3000/api/auth/webauthn/credentials?id=${registeredPasskeyId}`, {
        method: 'DELETE',
      }),
      { viewer: staffViewer, tokenHash: staffSession.tokenHash },
    )
    expect(deleteResponse.status).toBe(403)
    expect((await deleteResponse.json()).error).toBe('ASSURANCE_LEVEL_INSUFFICIENT')
    expect((await prisma.passkeyCredential.findUnique({ where: { id: registeredPasskeyId } })).status).toBe('ACTIVE')
  })

  it('generates login options and verifies passkey authentication (Passwordless Sign-In)', async () => {
    const factor = await prisma.mfaFactor.create({
      data: {
        personId: staffPerson.id,
        type: 'TOTP',
        secret: 'mfa.v0.passkey-login-gate-test.value',
        status: 'ACTIVE',
        verifiedAt: new Date(),
      },
    })
    const noElevationCookie = `webauthn-no-elevation-${randomUUID()}`
    await prisma.session.create({
      data: {
        personId: staffPerson.id,
        tokenHash: hashSessionToken(noElevationCookie),
        status: 'ACTIVE',
        assurance: 'WEBAUTHN',
        assuranceLevel: 'AAL2',
        elevatedUntil: null,
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    const noElevationRequest = mockRequest('http://localhost:3000/api/auth/mfa/factors', {
      method: 'DELETE',
      headers: { cookie: `${AUTH_SESSION_COOKIE}=${encodeURIComponent(noElevationCookie)}` },
      body: { factorId: factor.id },
    })
    await expect(assertCredentialWriteAssurance({
      viewer: staffViewer,
      request: noElevationRequest,
      db: prisma,
      env: {},
    })).rejects.toMatchObject({ status: 403, code: 'ASSURANCE_LEVEL_INSUFFICIENT' })
    const refusedDelete = await deleteFactor(noElevationRequest, { viewer: staffViewer })
    expect(refusedDelete.status).toBe(403)
    expect((await prisma.mfaFactor.findUnique({ where: { id: factor.id } })).status).toBe('ACTIVE')

    // 1. Get login options
    const optReq = mockRequest('http://localhost:3000/api/auth/webauthn/login/options', {
      method: 'POST',
      headers: { host: 'localhost:3000' },
      body: { email: 'staff.passkey@zuri.ai' },
    })
    const optRes = await postLoginOptions(optReq)
    expect(optRes.status).toBe(200)
    const { options } = await optRes.json()
    expect(options.challenge).toBeTruthy()
    const loginChallenge = options.challenge

    // 2. Sign assertion
    const rpIdHash = sha256(Buffer.from('localhost'))
    const flags = Buffer.from([0x01]) // UP
    const counterBuf = Buffer.alloc(4)
    counterBuf.writeUInt32BE(1, 0)
    const authenticatorData = Buffer.concat([rpIdHash, flags, counterBuf])

    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge: loginChallenge,
      origin: 'http://localhost:3000',
    })
    const clientDataBuf = Buffer.from(clientDataJSON)
    const clientDataHash = sha256(clientDataBuf)
    const signatureBase = Buffer.concat([authenticatorData, clientDataHash])

    const signature = sign('SHA256', signatureBase, keyPair.privateKey)

    const loginReq = mockRequest('http://localhost:3000/api/auth/webauthn/login/verify', {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
      body: {
        credential: {
          id: registeredCredentialId,
          response: {
            clientDataJSON: toBase64Url(clientDataBuf),
            authenticatorData: toBase64Url(authenticatorData),
            signature: toBase64Url(signature),
          },
        },
      },
    })

    const loginStartedAt = Date.now()
    const loginRes = await postLoginVerify(loginReq)
    const loginFinishedAt = Date.now()
    expect(loginRes.status).toBe(200)
    const loginData = await loginRes.json()
    expect(loginData.success).toBe(true)
    expect(loginData.user.email).toBe('staff.passkey@zuri.ai')
    expect(loginData.assuranceLevel).toBe('AAL2')

    const sessionCookie = loginRes.cookies.get(AUTH_SESSION_COOKIE)?.value
    expect(sessionCookie).toBeTruthy()
    const loginSession = await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(sessionCookie) } })
    expect(loginSession.assurance).toBe('WEBAUTHN')
    const loginElevatedUntilMs = new Date(loginSession.elevatedUntil).getTime()
    expect(loginElevatedUntilMs).toBeLessThanOrEqual(loginFinishedAt + 900_000)
    expect(loginElevatedUntilMs).toBeGreaterThanOrEqual(loginStartedAt + 900_000)

    const liveRequest = mockRequest('http://localhost:3000/api/auth/mfa/factors', {
      method: 'DELETE',
      headers: { cookie: `${AUTH_SESSION_COOKIE}=${encodeURIComponent(sessionCookie)}` },
      body: { factorId: factor.id },
    })
    await expect(assertCredentialWriteAssurance({
      viewer: staffViewer,
      request: liveRequest,
      db: prisma,
      env: {},
    })).resolves.toMatchObject({ personId: staffPerson.id, stepUp: 'VERIFIED' })
    const allowedDelete = await deleteFactor(liveRequest, { viewer: staffViewer })
    expect(allowedDelete.status).toBe(200)
    expect((await prisma.mfaFactor.findUnique({ where: { id: factor.id } })).status).toBe('REVOKED')
  })

  it('elevates an existing session to AAL2 via step-up with passkey', async () => {
    const sessionCookie = `webauthn-step-up-${randomUUID()}`
    staffSession = await prisma.session.update({
      where: { id: staffSession.id },
      data: { tokenHash: hashSessionToken(sessionCookie) },
    })
    staffViewer.session = staffSession
    staffViewer.sessionTokenHash = staffSession.tokenHash
    const { session: decoySession } = await createPersonSessionViewer('PK-STEPUP-DECOY')

    // 1. Get options
    const optReq = mockRequest('http://localhost:3000/api/auth/webauthn/login/options', {
      method: 'POST',
      headers: { host: 'localhost:3000' },
    })
    const optRes = await postLoginOptions(optReq)
    const { options } = await optRes.json()
    const challenge = options.challenge

    // 2. Sign assertion
    const rpIdHash = sha256(Buffer.from('localhost'))
    const flags = Buffer.from([0x01])
    const counterBuf = Buffer.alloc(4)
    counterBuf.writeUInt32BE(2, 0)
    const authenticatorData = Buffer.concat([rpIdHash, flags, counterBuf])

    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge,
      origin: 'http://localhost:3000',
    })
    const clientDataBuf = Buffer.from(clientDataJSON)
    const clientDataHash = sha256(clientDataBuf)
    const signatureBase = Buffer.concat([authenticatorData, clientDataHash])

    const signature = sign('SHA256', signatureBase, keyPair.privateKey)

    const stepUpReq = mockRequest('http://localhost:3000/api/auth/webauthn/step-up', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        cookie: `${AUTH_SESSION_COOKIE}=${encodeURIComponent(sessionCookie)}`,
      },
      body: {
        ttlSeconds: 31536000,
        credential: {
          id: registeredCredentialId,
          response: {
            clientDataJSON: toBase64Url(clientDataBuf),
            authenticatorData: toBase64Url(authenticatorData),
            signature: toBase64Url(signature),
          },
        },
      },
    })

    const stepUpRes = await postStepUp(stepUpReq, { viewer: staffViewer, tokenHash: decoySession.tokenHash })
    expect(stepUpRes.status).toBe(200)
    const stepUpData = await stepUpRes.json()
    expect(stepUpData.elevated).toBe(true)
    expect(stepUpData.assuranceLevel).toBe('AAL2')
    expect(stepUpData.elevatedUntil).toBeTruthy()
    expect(new Date(stepUpData.elevatedUntil).getTime() - Date.now()).toBeLessThanOrEqual(900_000)
    const elevatedSession = await prisma.session.findUnique({ where: { id: staffSession.id } })
    expect(elevatedSession.assuranceLevel).toBe('AAL2')
    expect(resolveSessionAssurance(elevatedSession)).toBe('AAL2')
    expect(new Date(elevatedSession.elevatedUntil).getTime() - Date.now()).toBeLessThanOrEqual(900_000)
    expect((await prisma.session.findUnique({ where: { id: decoySession.id } })).elevatedUntil).toBeNull()
  })

  it('revokes a registered passkey', async () => {
    const req = mockRequest(`http://localhost:3000/api/auth/webauthn/credentials?id=${registeredPasskeyId}`, {
      method: 'DELETE',
    })
    const res = await deletePasskey(req, { viewer: staffViewer, tokenHash: staffSession.tokenHash })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.status).toBe('REVOKED')

    const inDb = await prisma.passkeyCredential.findUnique({
      where: { id: registeredPasskeyId },
    })
    expect(inDb.status).toBe('REVOKED')
    expect(inDb.revokedAt).toBeTruthy()
  })

  it('requires live AAL2 for passkey registration when a TOTP factor is already active', async () => {
    const suffix = randomUUID()
    const person = await prisma.person.create({
      data: {
        code: `PSN-PK-GATE-${suffix.slice(0, 8)}`,
        displayName: 'Passkey Gate User',
        email: `passkey-gate-${suffix}@zuri.ai`,
      },
    })
    const session = await prisma.session.create({
      data: {
        personId: person.id,
        tokenHash: `pk-gate-${suffix}`,
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

    const totp = await prisma.mfaFactor.create({
      data: {
        personId: person.id,
        type: 'TOTP',
        secret: 'mfa.v0.active-factor-placeholder.value',
        status: 'ACTIVE',
        verifiedAt: new Date(),
      },
    })
    const passkeyCount = await prisma.passkeyCredential.count({ where: { personId: person.id } })

    const deniedOptions = await postRegisterOptions(
      mockRequest('http://localhost:3000/api/auth/webauthn/register/options', {
        method: 'POST',
        headers: { host: 'localhost:3000' },
      }),
      { viewer, tokenHash: session.tokenHash },
    )
    expect(deniedOptions.status).toBe(403)
    expect((await deniedOptions.json()).error).toBe('ASSURANCE_LEVEL_INSUFFICIENT')
    expect(await prisma.passkeyCredential.count({ where: { personId: person.id } })).toBe(passkeyCount)

    // An options challenge started before an active factor appeared is not an exemption.
    await prisma.mfaFactor.update({ where: { id: totp.id }, data: { status: 'REVOKED', revokedAt: new Date() } })
    const allowedOptions = await postRegisterOptions(
      mockRequest('http://localhost:3000/api/auth/webauthn/register/options', {
        method: 'POST',
        headers: { host: 'localhost:3000' },
      }),
      { viewer, tokenHash: session.tokenHash },
    )
    expect(allowedOptions.status).toBe(200)
    const { options } = await allowedOptions.json()

    await prisma.mfaFactor.create({
      data: {
        personId: person.id,
        type: 'TOTP',
        secret: 'mfa.v0.active-factor-placeholder.value',
        status: 'ACTIVE',
        verifiedAt: new Date(),
      },
    })
    const rawCredentialId = `blocked-passkey-${suffix}`
    const credentialId = toBase64Url(Buffer.from(rawCredentialId))
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.create',
      challenge: options.challenge,
      origin: 'http://localhost:3000',
    })
    const refusedConfirmation = await postRegisterVerify(
      mockRequest('http://localhost:3000/api/auth/webauthn/register/verify', {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
        body: {
          credential: {
            id: credentialId,
            rawId: credentialId,
            response: {
              clientDataJSON: toBase64Url(Buffer.from(clientDataJSON)),
              attestationObject: toBase64Url(buildMockAttestationObject({
                rpId: 'localhost',
                credentialId: rawCredentialId,
                publicKeyJwk: jwk,
              })),
            },
            type: 'public-key',
          },
        },
      }),
      { viewer, tokenHash: session.tokenHash },
    )
    expect(refusedConfirmation.status).toBe(403)
    expect((await refusedConfirmation.json()).error).toBe('ASSURANCE_LEVEL_INSUFFICIENT')
    expect(await prisma.passkeyCredential.count({ where: { personId: person.id } })).toBe(passkeyCount)
  })

  it('rechecks the recent step-up at passkey registration confirmation after the window lapses', async () => {
    const { person, session, viewer } = await createPersonSessionViewer('PK-LAPSED-WINDOW', {
      elevatedUntil: new Date(Date.now() + 900000),
    })
    await prisma.mfaFactor.create({
      data: {
        personId: person.id,
        type: 'TOTP',
        secret: 'mfa.v0.active-factor-placeholder.value',
        status: 'ACTIVE',
        verifiedAt: new Date(),
      },
    })

    const optionsResponse = await postRegisterOptions(
      mockRequest('http://localhost:3000/api/auth/webauthn/register/options', {
        method: 'POST',
        headers: { host: 'localhost:3000' },
      }),
      { viewer, tokenHash: session.tokenHash },
    )
    expect(optionsResponse.status).toBe(200)
    const { options } = await optionsResponse.json()
    expect(options.challenge).toBeTruthy()

    await prisma.session.update({
      where: { id: session.id },
      data: { elevatedUntil: new Date(Date.now() - 1000) },
    })
    const beforeCount = await prisma.passkeyCredential.count({ where: { personId: person.id } })
    const refused = await postRegisterVerify(
      mockRequest('http://localhost:3000/api/auth/webauthn/register/verify', {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
        body: { credential: { id: 'must-not-be-created' } },
      }),
      { viewer, tokenHash: session.tokenHash },
    )
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toBe('ASSURANCE_LEVEL_INSUFFICIENT')
    expect(await prisma.passkeyCredential.count({ where: { personId: person.id } })).toBe(beforeCount)
  })

  it('refuses factor starts and deletions when the cookie belongs to another elevated Person', async () => {
    const { person: target, session: targetSession, viewer: targetViewer } = await createPersonSessionViewer('PK-COOKIE-TARGET', {
      elevatedUntil: new Date(Date.now() + 900000),
    })
    const { person: foreign, session: foreignSession, viewer: foreignViewer } = await createPersonSessionViewer('PK-COOKIE-FOREIGN', {
      elevatedUntil: new Date(Date.now() + 900000),
    })
    expect(foreignViewer.principal.id).toBe(foreign.id)
    expect(targetViewer.principal.id).toBe(target.id)

    const factor = await prisma.mfaFactor.create({
      data: {
        personId: target.id,
        type: 'TOTP',
        secret: 'mfa.v0.active-factor-placeholder.value',
        status: 'ACTIVE',
        verifiedAt: new Date(),
      },
    })
    const passkey = await prisma.passkeyCredential.create({
      data: {
        personId: target.id,
        credentialId: `foreign-cookie-passkey-${randomUUID()}`,
        publicKey: 'test-public-key',
        deviceLabel: 'Cookie ownership test',
        status: 'ACTIVE',
      },
    })
    const foreignCookie = `foreign-session-${randomUUID()}`
    await prisma.session.update({
      where: { id: foreignSession.id },
      data: { tokenHash: hashSessionToken(foreignCookie) },
    })
    const headers = {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      cookie: `${AUTH_SESSION_COOKIE}=${encodeURIComponent(foreignCookie)}`,
    }
    const tokenHash = targetSession.tokenHash

    const refusedTotpStart = await postEnrollTotp(
      mockRequest('http://localhost:3000/api/auth/mfa/totp/enroll', { method: 'POST', headers }),
      { viewer: targetViewer, tokenHash },
    )
    expect(refusedTotpStart.status).toBe(403)

    const refusedPasskeyStart = await postRegisterOptions(
      mockRequest('http://localhost:3000/api/auth/webauthn/register/options', { method: 'POST', headers }),
      { viewer: targetViewer, tokenHash },
    )
    expect(refusedPasskeyStart.status).toBe(403)

    const refusedTotpDelete = await deleteFactor(
      mockRequest('http://localhost:3000/api/auth/mfa/factors', {
        method: 'DELETE',
        headers,
        body: { factorId: factor.id },
      }),
      { viewer: targetViewer, tokenHash },
    )
    expect(refusedTotpDelete.status).toBe(403)

    const refusedPasskeyDelete = await deletePasskey(
      mockRequest(`http://localhost:3000/api/auth/webauthn/credentials?id=${passkey.id}`, { method: 'DELETE', headers }),
      { viewer: targetViewer, tokenHash },
    )
    expect(refusedPasskeyDelete.status).toBe(403)
    expect((await prisma.mfaFactor.findUnique({ where: { id: factor.id } })).status).toBe('ACTIVE')
    expect((await prisma.passkeyCredential.findUnique({ where: { id: passkey.id } })).status).toBe('ACTIVE')
    expect(await prisma.mfaFactor.count({ where: { personId: target.id } })).toBe(1)
  })
})
