// @req FR-NEW — an OAUTH_CLIENT or MODEL_PROVIDER_KEY credential follows the same
//   write-only, versioned, scope-rechecked lifecycle as a LINE channel credential
//   (SEC-030) through the existing SecretStorePort: version + PENDING_VALIDATION,
//   activate, rotate (previous version stays resolvable until the new one
//   validates, then is purged), revoke (fence-then-purge), and resolve is refused
//   across kinds exactly as it is refused across stores.
// @spec ADR-089 D1, D2, D5 and proofs 1-3; SDD-097; SEC-030; ADR-089 §4.8 phase 7
// @tested tests/integration/credential-vault-provider-kinds-lifecycle.test.js
import { randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { createEnvelopeSecretStore } from '@/platform/integrations/core/secret-store/envelope-secret-store'
import { createDispatchingSecretManager } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import {
  markCredentialsReentryRequired,
  revokeCredential,
  storeValidatedCredential,
} from '@/platform/integrations/core/secret-store/credential-lifecycle'
import {
  errorTrace,
  findLeaks,
  generateModelProviderKeyBundle,
  generateOauthClientBundle,
  secretNeedles,
} from '../helpers/credential-vault-fixtures'

const ENV = { NODE_ENV: 'test', ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: randomBytes(32).toString('hex'), ZURI_SECRET_KEK_VERSION: '1' }
const store = createEnvelopeSecretStore({ db: prisma, env: ENV })
const manager = createDispatchingSecretManager({ writableStore: store })
const allBundles = []
let tenant, business, provider

async function newConnection() {
  const connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: `Provider ${randomUUID().slice(0, 6)}`, status: 'ACTIVE',
  })
  return { connection, scope: { tenantId: tenant.id, businessId: business.id, connectionId: connection.id } }
}

function oauthBundle() {
  const value = generateOauthClientBundle()
  allBundles.push(value)
  return value
}

function modelKeyBundle() {
  const value = generateModelProviderKeyBundle()
  allBundles.push(value)
  return value
}

const credentialOf = connectionId => prisma.integrationCredential.findUnique({ where: { connectionId }, include: { versions: { orderBy: { versionNumber: 'asc' } } } })

describe.each([
  ['OAUTH_CLIENT', oauthBundle, b => b.clientId.slice(-4)],
  ['MODEL_PROVIDER_KEY', modelKeyBundle, () => null],
])('credential vault lifecycle for %s (envelope store, SQLite)', (kind, makeBundle, hintOf) => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: `PF-${kind}`, name: kind })
    tenant = await createTenant({ portfolioId: portfolio.id, code: `TNT-${kind}`, name: kind })
    business = await createBusiness({ tenantId: tenant.id, code: `BUS-${kind}`, name: kind })
    provider = await registerIntegrationProvider({ code: `TEST_${kind}_PROVIDER`, name: `Test ${kind} provider` })
  })

  it('writes a new version PENDING_VALIDATION that resolves only after activation, with the kind-appropriate display hint', async () => {
    const { scope } = await newConnection()
    const first = makeBundle()
    const written = await store.write({ ...scope, kind, bundle: first, createdVia: 'BROWSER_MFA', actorPersonId: 'person-1' })
    expect(written).toMatchObject({ versionNumber: 1 })
    expect(written.secretRef).toMatch(/^envelope:/)
    let credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'PENDING_VALIDATION', secretStore: 'ENVELOPE', secretKind: kind, displayHint: hintOf(first), version: 1 })
    await expect(manager.resolve(written.secretRef, { ...scope, kind })).rejects.toMatchObject({ code: 'NotFound' })

    const activated = await store.activate({ ...scope, versionNumber: 1, validationCode: 'VALIDATED' })
    expect(activated).toMatchObject({ versionNumber: 1, supersededCount: 0 })
    credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'ACTIVE', lastValidationCode: 'VALIDATED' })
    const resolved = await manager.resolve(written.secretRef, { ...scope, kind })
    expect(JSON.parse(resolved.material)).toEqual(first)
    expect(resolved.version).toBe('credential-v1')
  })

  it('rotation keeps the previous version resolvable until the new one validates, then purges it', async () => {
    const { scope } = await newConnection()
    const first = makeBundle()
    const v1 = await storeValidatedCredential({ store, ...scope, kind, bundle: first, validationCode: 'VALIDATED' })
    const second = makeBundle()
    const v2 = await store.write({ ...scope, kind, bundle: second, createdVia: 'BROWSER_MFA' })

    let credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'ROTATING', secretRef: v1.secretRef, version: 2 })
    expect(JSON.parse((await manager.resolve(credential.secretRef, { ...scope, kind })).material)).toEqual(first)

    const activated = await store.activate({ ...scope, versionNumber: v2.versionNumber, validationCode: 'VALIDATED' })
    expect(activated).toMatchObject({ supersededCount: 1, purgeFailedCount: 0 })
    credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'ACTIVE', secretRef: v2.secretRef, displayHint: hintOf(second) })
    expect(credential.versions.map(v => [v.versionNumber, v.status])).toEqual([[1, 'PURGED'], [2, 'ACTIVE']])
    await expect(manager.resolve(v1.secretRef, { ...scope, kind })).rejects.toMatchObject({ code: 'NotFound' })
    expect(JSON.parse((await manager.resolve(v2.secretRef, { ...scope, kind })).material)).toEqual(second)
  })

  it('revocation fences first, then purges every version, and the credential stops resolving', async () => {
    const { scope } = await newConnection()
    const v1 = await storeValidatedCredential({ store, ...scope, kind, bundle: makeBundle(), validationCode: 'VALIDATED' })
    await store.write({ ...scope, kind, bundle: makeBundle(), createdVia: 'BROWSER_MFA' })
    const order = []
    const result = await revokeCredential({
      store, ...scope, reason: 'owner revoked',
      fence: async () => { order.push('fence') },
      onInvalidate: async ({ refs }) => order.push(`invalidate:${refs.length}`),
    })
    expect(order).toEqual(['fence', 'invalidate:2'])
    expect(result).toMatchObject({ credentialStatus: 'REVOKED', revokedCount: 2, purgedCount: 2, purgeFailedCount: 0 })
    const credential = await credentialOf(scope.connectionId)
    expect(credential.versions.every(v => v.status === 'PURGED')).toBe(true)
    await expect(manager.resolve(v1.secretRef, { ...scope, kind })).rejects.toMatchObject({ code: 'NotFound' })
  })

  it('a restored credential needs re-entry: it stops resolving and the next write replaces it', async () => {
    const { scope } = await newConnection()
    const v1 = await storeValidatedCredential({ store, ...scope, kind, bundle: makeBundle(), validationCode: 'VALIDATED' })
    expect(await markCredentialsReentryRequired(prisma, { connectionIds: [scope.connectionId] })).toBe(1)
    await expect(manager.resolve(v1.secretRef, { ...scope, kind })).rejects.toMatchObject({ code: 'NotFound' })
    const fresh = makeBundle()
    const v3 = await store.write({ ...scope, kind, bundle: fresh, createdVia: 'BROWSER_MFA' })
    await store.activate({ ...scope, versionNumber: v3.versionNumber, validationCode: 'VALIDATED' })
    expect(JSON.parse((await manager.resolve(v3.secretRef, { ...scope, kind })).material)).toEqual(fresh)
  })

  it('the bundle schema is enforced at write time, before any material is stored', async () => {
    const { scope } = await newConnection()
    const before = await prisma.integrationSecretEnvelope.count()
    const malformed = kind === 'OAUTH_CLIENT' ? { clientId: 'x' } : { apiKey: 'too-short' }
    await expect(store.write({ ...scope, kind, bundle: malformed, createdVia: 'BROWSER_MFA' }))
      .rejects.toMatchObject({ code: 'CHANNEL_SECRET_BUNDLE_INVALID' })
    expect(await prisma.integrationSecretEnvelope.count()).toBe(before)
  })

  it('refuses another Tenant or Business, before anything is written', async () => {
    const { scope } = await newConnection()
    const other = await createTenant({ portfolioId: (await createPortfolio({ code: `PF-${kind}-2`, name: kind })).id, code: `TNT-${kind}-2`, name: kind })
    const before = await prisma.integrationSecretEnvelope.count()
    await expect(store.write({ ...scope, tenantId: other.id, kind, bundle: makeBundle(), createdVia: 'BROWSER_MFA' }))
      .rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    expect(await prisma.integrationSecretEnvelope.count()).toBe(before)
  })

  it('leaves no material in any Prisma column or error trace', async () => {
    const { scope } = await newConnection()
    const secret = makeBundle()
    const stored = await storeValidatedCredential({ store, ...scope, kind, bundle: secret, validationCode: 'VALIDATED' })
    expect(stored.versionNumber).toBe(1)
    const needles = [...new Set(allBundles.flatMap(secretNeedles))]
    const rows = await prisma.integrationCredential.findMany({ where: { connectionId: scope.connectionId } })
    const versions = await prisma.integrationCredentialVersion.findMany({ where: { credentialId: rows[0]?.id } })
    expect(findLeaks({ rows, versions }, needles)).toEqual([])
    const refusal = await store.write({ ...scope, businessId: randomUUID(), kind, bundle: secret, createdVia: 'BROWSER_MFA' }).catch(e => e)
    expect(findLeaks({ refusal: errorTrace(refusal) }, needles)).toEqual([])
  })
})

describe('cross-kind refusal (a reference never resolves as the wrong kind)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-XKIND', name: 'cross-kind' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-XKIND', name: 'cross-kind' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-XKIND', name: 'cross-kind' })
    provider = await registerIntegrationProvider({ code: 'TEST_XKIND_PROVIDER', name: 'Test cross-kind provider' })
  })

  it('a MODEL_PROVIDER_KEY reference never resolves as LINE_CHANNEL, OAUTH_CLIENT, or with no kind (defaults to LINE_CHANNEL)', async () => {
    const { scope } = await newConnection()
    const written = await storeValidatedCredential({
      store, ...scope, kind: 'MODEL_PROVIDER_KEY', bundle: generateModelProviderKeyBundle(), validationCode: 'VALIDATED',
    })
    await expect(manager.resolve(written.secretRef, { ...scope, kind: 'LINE_CHANNEL', destination: 'anything' })).rejects.toMatchObject({ code: 'NotFound' })
    await expect(manager.resolve(written.secretRef, { ...scope, kind: 'OAUTH_CLIENT' })).rejects.toMatchObject({ code: 'NotFound' })
    // No kind at all defaults to LINE_CHANNEL and also requires a destination — still refused.
    await expect(manager.resolve(written.secretRef, scope)).rejects.toMatchObject({ code: 'NotFound' })
    // The right kind still resolves.
    const resolved = await manager.resolve(written.secretRef, { ...scope, kind: 'MODEL_PROVIDER_KEY' })
    expect(resolved.material).toBeDefined()
  })

  it('a LINE_CHANNEL reference never resolves as OAUTH_CLIENT or MODEL_PROVIDER_KEY', async () => {
    const destination = `U${randomBytes(16).toString('hex')}`
    const lineProvider = await registerIntegrationProvider({ code: 'LINE_OA', name: 'LINE Official Account' })
    const connection = await createIntegrationConnection({
      tenantId: tenant.id, businessId: business.id, providerId: lineProvider.id,
      name: 'LINE for cross-kind', externalAccountId: destination, status: 'ACTIVE',
    })
    const scope = { tenantId: tenant.id, businessId: business.id, connectionId: connection.id }
    const written = await storeValidatedCredential({
      store, ...scope, kind: 'LINE_CHANNEL',
      bundle: { channelId: '1234567890', channelSecret: randomBytes(16).toString('hex') },
      validationCode: 'LINE_OK',
    })
    await expect(manager.resolve(written.secretRef, { ...scope, kind: 'OAUTH_CLIENT' })).rejects.toMatchObject({ code: 'NotFound' })
    await expect(manager.resolve(written.secretRef, { ...scope, kind: 'MODEL_PROVIDER_KEY' })).rejects.toMatchObject({ code: 'NotFound' })
    const resolved = await manager.resolve(written.secretRef, { ...scope, kind: 'LINE_CHANNEL', destination })
    expect(resolved.material).toBeDefined()
  })

  it('writing a different kind to a connectionId that already holds a credential is refused, live or dead, before anything is written (regression: silent cross-kind rotation)', async () => {
    const { scope } = await newConnection()
    const line = await storeValidatedCredential({
      store, ...scope, kind: 'LINE_CHANNEL',
      bundle: { channelId: '1234567891', channelSecret: randomBytes(16).toString('hex') },
      validationCode: 'LINE_OK',
    })
    const before = await prisma.integrationSecretEnvelope.count()

    // The live LINE_CHANNEL row must not be rotated into an OAUTH_CLIENT or
    // MODEL_PROVIDER_KEY version — that would leave secretKind='LINE_CHANNEL' on
    // a row whose latest version is actually OAuth/model material, and a caller
    // resolving with the default kind would decrypt the wrong thing as LINE.
    await expect(store.write({ ...scope, kind: 'OAUTH_CLIENT', bundle: generateOauthClientBundle(), createdVia: 'BROWSER_MFA' }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_KIND_MISMATCH', status: 409 })
    await expect(store.write({ ...scope, kind: 'MODEL_PROVIDER_KEY', bundle: generateModelProviderKeyBundle(), createdVia: 'BROWSER_MFA' }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_KIND_MISMATCH', status: 409 })
    expect(await prisma.integrationSecretEnvelope.count()).toBe(before)
    const credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'ACTIVE', secretKind: 'LINE_CHANNEL', secretRef: line.secretRef, version: 1 })
    // The right kind still writes and resolves fine after the refusals above.
    await expect(store.write({ ...scope, kind: 'LINE_CHANNEL', bundle: { channelId: '1234567892', channelSecret: randomBytes(16).toString('hex') }, createdVia: 'BROWSER_MFA' }))
      .resolves.toMatchObject({ versionNumber: 2 })
  })

  it('the same guard also refuses the reverse direction: a MODEL_PROVIDER_KEY connection cannot be silently switched to OAUTH_CLIENT or LINE_CHANNEL', async () => {
    const { scope } = await newConnection()
    await storeValidatedCredential({ store, ...scope, kind: 'MODEL_PROVIDER_KEY', bundle: generateModelProviderKeyBundle(), validationCode: 'VALIDATED' })
    await expect(store.write({ ...scope, kind: 'OAUTH_CLIENT', bundle: generateOauthClientBundle(), createdVia: 'BROWSER_MFA' }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_KIND_MISMATCH' })
    await expect(store.write({ ...scope, kind: 'LINE_CHANNEL', bundle: { channelId: '1234567893', channelSecret: randomBytes(16).toString('hex') }, createdVia: 'BROWSER_MFA' }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_KIND_MISMATCH' })
  })

  it('an unrecognized kind is refused, never default-permitted', async () => {
    const { scope } = await newConnection()
    const written = await storeValidatedCredential({
      store, ...scope, kind: 'MODEL_PROVIDER_KEY', bundle: generateModelProviderKeyBundle(), validationCode: 'VALIDATED',
    })
    await expect(manager.resolve(written.secretRef, { ...scope, kind: 'SOMETHING_UNKNOWN' })).rejects.toMatchObject({ code: 'NotFound' })
    await expect(store.write({ ...scope, kind: 'SOMETHING_UNKNOWN', bundle: generateModelProviderKeyBundle(), createdVia: 'BROWSER_MFA' }))
      .rejects.toMatchObject({ code: 'CHANNEL_SECRET_BUNDLE_INVALID' })
  })
})
