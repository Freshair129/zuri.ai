import { beforeAll, describe, expect, it } from 'vitest'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
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
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
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

    const res = await postRegisterVerify(req, { viewer: staffViewer })
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

  it('generates login options and verifies passkey authentication (Passwordless Sign-In)', async () => {
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

    const loginRes = await postLoginVerify(loginReq)
    expect(loginRes.status).toBe(200)
    const loginData = await loginRes.json()
    expect(loginData.success).toBe(true)
    expect(loginData.user.email).toBe('staff.passkey@zuri.ai')
    expect(loginData.assuranceLevel).toBe('AAL2')
  })

  it('elevates an existing session to AAL2 via step-up with passkey', async () => {
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

    const stepUpRes = await postStepUp(stepUpReq, { viewer: staffViewer })
    expect(stepUpRes.status).toBe(200)
    const stepUpData = await stepUpRes.json()
    expect(stepUpData.elevated).toBe(true)
    expect(stepUpData.assuranceLevel).toBe('AAL2')
    expect(stepUpData.elevatedUntil).toBeTruthy()
  })

  it('revokes a registered passkey', async () => {
    const req = mockRequest(`http://localhost:3000/api/auth/webauthn/credentials?id=${registeredPasskeyId}`, {
      method: 'DELETE',
    })
    const res = await deletePasskey(req, { viewer: staffViewer })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.status).toBe('REVOKED')

    const inDb = await prisma.passkeyCredential.findUnique({
      where: { id: registeredPasskeyId },
    })
    expect(inDb.status).toBe('REVOKED')
    expect(inDb.revokedAt).toBeTruthy()
  })
})
