// @req FR-223 — the credential vault lifecycle on SQLite with the envelope store:
//   versioned write and activation, rotation that keeps the previous version
//   resolvable, rejection, revocation with the account fenced first and material
//   purged, compensation of a failed follow-up, re-entry after restore, and a leak
//   scan of every place a secret may not be.
// @spec ADR-089 D1, D2, D5 and proofs 1-3; SDD-097; SEC-030
// @tested tests/integration/credential-vault-lifecycle.test.js
import { randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { createEnvelopeSecretStore, openSecretEnvelope } from '@/platform/integrations/core/secret-store/envelope-secret-store'
import { createDispatchingSecretManager } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import {
  credentialAuditPayload,
  markCredentialsReentryRequired,
  revokeCredential,
  storeValidatedCredential,
} from '@/platform/integrations/core/secret-store/credential-lifecycle'
import { resolveServerLineAccount } from '@/platform/integrations/providers/line/server-line-transport'
import { connectLineOaAccount, fenceLineOaAccountForCredentialRevocation } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { exportSnapshot } from '@/modules/project-manager/application/backup-service'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { captureConsole, errorTrace, findLeaks, generateLineChannelBundle, secretNeedles } from '../helpers/credential-vault-fixtures'

const ENV = { NODE_ENV: 'test', ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: randomBytes(32).toString('hex'), ZURI_SECRET_KEK_VERSION: '1' }
const store = createEnvelopeSecretStore({ db: prisma, env: ENV })
const manager = createDispatchingSecretManager({ writableStore: store })
const allBundles = []
let tenant, business, otherBusiness, provider

async function newConnection(forBusiness = business) {
  const destination = `U${randomBytes(16).toString('hex')}`
  const connection = await createIntegrationConnection({
    tenantId: forBusiness.tenantId, businessId: forBusiness.id, providerId: provider.id,
    name: `Vault ${destination.slice(-6)}`, externalAccountId: destination, status: 'ACTIVE',
  })
  return { connection, scope: { tenantId: forBusiness.tenantId, businessId: forBusiness.id, connectionId: connection.id }, destination }
}

function bundle(options) {
  const value = generateLineChannelBundle(options)
  allBundles.push(value)
  return value
}

const credentialOf = connectionId => prisma.integrationCredential.findUnique({ where: { connectionId }, include: { versions: { orderBy: { versionNumber: 'asc' } } } })
const envelopeCount = connectionId => prisma.integrationSecretEnvelope.count({ where: { connectionId } })

describe('credential vault lifecycle (envelope store, SQLite)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-VAULT', name: 'Vault' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-VAULT', name: 'Vault' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-VAULT', name: 'Vault' })
    const otherTenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-VAULT-2', name: 'Vault other' })
    otherBusiness = await createBusiness({ tenantId: otherTenant.id, code: 'BUS-VAULT-2', name: 'Vault other' })
    provider = await registerIntegrationProvider({ code: 'LINE_OA', name: 'LINE Official Account' })
  })

  it('writes a new version PENDING_VALIDATION that resolves only after activation', async () => {
    const { scope, destination } = await newConnection()
    const first = bundle({ withToken: true })
    const written = await store.write({ ...scope, kind: 'LINE_CHANNEL', bundle: first, createdVia: 'BROWSER_MFA', actorPersonId: 'person-1' })
    expect(written).toMatchObject({ versionNumber: 1 })
    expect(written.secretRef).toMatch(/^envelope:/)
    let credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'PENDING_VALIDATION', secretStore: 'ENVELOPE', displayHint: first.channelId.slice(-4), version: 1 })
    await expect(manager.resolve(written.secretRef, { ...scope, destination })).rejects.toMatchObject({ code: 'NotFound' })

    const activated = await store.activate({ ...scope, versionNumber: 1, validationCode: 'LINE_OK' })
    expect(activated).toMatchObject({ versionNumber: 1, supersededCount: 0 })
    credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'ACTIVE', lastValidationCode: 'LINE_OK' })
    expect(credential.versions.map(v => [v.versionNumber, v.status, v.createdVia])).toEqual([[1, 'ACTIVE', 'BROWSER_MFA']])
    const resolved = await manager.resolve(written.secretRef, { ...scope, destination })
    expect(JSON.parse(resolved.material)).toEqual(first)
    expect(resolved.version).toBe('credential-v1')
  })

  it('rotation keeps the previous version resolvable until the new one validates, then purges it', async () => {
    const { scope, destination } = await newConnection()
    const first = bundle({ withToken: true })
    const v1 = await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: first, validationCode: 'LINE_OK' })
    const second = bundle({ withToken: true })
    const v2 = await store.write({ ...scope, kind: 'LINE_CHANNEL', bundle: second, createdVia: 'BROWSER_MFA' })

    let credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'ROTATING', secretRef: v1.secretRef, version: 2 })
    expect(JSON.parse((await manager.resolve(credential.secretRef, { ...scope, destination })).material)).toEqual(first)

    const activated = await store.activate({ ...scope, versionNumber: v2.versionNumber, validationCode: 'LINE_OK' })
    expect(activated).toMatchObject({ supersededCount: 1, purgeFailedCount: 0 })
    credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'ACTIVE', secretRef: v2.secretRef, displayHint: second.channelId.slice(-4) })
    expect(credential.rotatedAt).not.toBeNull()
    expect(credential.versions.map(v => [v.versionNumber, v.status])).toEqual([[1, 'PURGED'], [2, 'ACTIVE']])
    expect(await envelopeCount(scope.connectionId)).toBe(1)
    await expect(manager.resolve(v1.secretRef, { ...scope, destination })).rejects.toMatchObject({ code: 'NotFound' })
    expect(JSON.parse((await manager.resolve(v2.secretRef, { ...scope, destination })).material)).toEqual(second)

    // A second activation of the same version is a lost race, not a second success.
    await expect(store.activate({ ...scope, versionNumber: 2, validationCode: 'LINE_OK' })).rejects.toMatchObject({ code: 'CREDENTIAL_VERSION_CONFLICT' })
  })

  it('a rejected pending version is purged and the live version keeps resolving', async () => {
    const { scope, destination } = await newConnection()
    const live = bundle({ withToken: true })
    const v1 = await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: live, validationCode: 'LINE_OK' })
    const v2 = await store.write({ ...scope, kind: 'LINE_CHANNEL', bundle: bundle(), createdVia: 'BROWSER_MFA' })
    const rejected = await store.revoke({ ...scope, reason: 'LINE_CREDENTIALS_REJECTED', versionNumber: v2.versionNumber })
    expect(rejected).toMatchObject({ credentialStatus: 'ACTIVE', revokedCount: 1, purgedCount: 1, purgeFailedCount: 0 })
    const credential = await credentialOf(scope.connectionId)
    expect(credential.versions.map(v => [v.versionNumber, v.status])).toEqual([[1, 'ACTIVE'], [2, 'PURGED']])
    expect(JSON.parse((await manager.resolve(v1.secretRef, { ...scope, destination })).material)).toEqual(live)
  })

  it('refuses another Tenant or Business in the store, before anything is written (proof 2)', async () => {
    const { scope, destination } = await newConnection()
    const before = await prisma.integrationSecretEnvelope.count()
    for (const foreign of [
      { ...scope, tenantId: otherBusiness.tenantId },
      { ...scope, businessId: otherBusiness.id },
      { ...scope, tenantId: otherBusiness.tenantId, businessId: otherBusiness.id },
    ]) {
      await expect(store.write({ ...foreign, kind: 'LINE_CHANNEL', bundle: bundle(), createdVia: 'BROWSER_MFA' })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    }
    expect(await prisma.integrationSecretEnvelope.count()).toBe(before)

    const v1 = await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
    await expect(store.activate({ ...scope, businessId: otherBusiness.id, versionNumber: 1, validationCode: 'LINE_OK' })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    await expect(store.revoke({ ...scope, tenantId: otherBusiness.tenantId, reason: 'x' })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    for (const foreign of [
      { ...scope, destination: `U${'0'.repeat(32)}` },
      { ...scope, businessId: otherBusiness.id, destination },
      { ...scope, connectionId: randomUUID(), destination },
    ]) {
      await expect(manager.resolve(v1.secretRef, foreign)).rejects.toMatchObject({ code: 'NotFound' })
    }
  })

  it('an envelope row moved onto another connection is refused by the AAD check', async () => {
    const victim = await newConnection()
    const attacker = await newConnection()
    const victimRef = (await storeValidatedCredential({ store, ...victim.scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })).secretRef
    const attackerRef = (await storeValidatedCredential({ store, ...attacker.scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })).secretRef
    const victimRow = await prisma.integrationSecretEnvelope.findUnique({ where: { id: victimRef.slice('envelope:'.length) } })
    // Someone with database write access copies the victim's ciphertext under the
    // attacker's envelope id and connection. The rows now agree; the AAD does not.
    await prisma.integrationSecretEnvelope.update({
      where: { id: attackerRef.slice('envelope:'.length) },
      data: { kekId: victimRow.kekId, wrappedDek: victimRow.wrappedDek, iv: victimRow.iv, tag: victimRow.tag, ciphertext: victimRow.ciphertext },
    })
    await expect(store.resolve(attackerRef, { ...attacker.scope, destination: attacker.destination })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    expect(() => openSecretEnvelope(victimRow, { ...attacker.scope, versionNumber: 1 }, ENV)).toThrow('CHANNEL_SECRET_SCOPE_MISMATCH')
  })

  it('revocation fences first, then purges every version, and the credential stops resolving', async () => {
    const { scope, destination } = await newConnection()
    const v1 = await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
    await store.write({ ...scope, kind: 'LINE_CHANNEL', bundle: bundle(), createdVia: 'BROWSER_MFA' })
    const order = []
    const result = await revokeCredential({
      store, ...scope, reason: 'owner revoked',
      fence: async () => { order.push('fence'); expect((await credentialOf(scope.connectionId)).status).toBe('ROTATING') },
      onInvalidate: async ({ refs }) => order.push(`invalidate:${refs.length}`),
    })
    expect(order).toEqual(['fence', 'invalidate:2'])
    expect(result).toMatchObject({ credentialStatus: 'REVOKED', revokedCount: 2, purgedCount: 2, purgeFailedCount: 0 })
    const credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'REVOKED', revokeReason: 'owner revoked' })
    expect(credential.versions.every(v => v.status === 'PURGED')).toBe(true)
    expect(await envelopeCount(scope.connectionId)).toBe(0)
    await expect(manager.resolve(v1.secretRef, { ...scope, destination })).rejects.toMatchObject({ code: 'NotFound' })
  })

  it('a purge that fails leaves REVOKED, not PURGED, for a reconciler', async () => {
    const { scope } = await newConnection()
    await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
    const failingDb = new Proxy(prisma, {
      get(target, key) {
        if (key !== '$transaction') return target[key]
        return (work, options) => target.$transaction(tx => work(new Proxy(tx, {
          get(inner, name) {
            if (name !== 'integrationSecretEnvelope') return inner[name]
            return { ...inner.integrationSecretEnvelope, deleteMany: async () => { throw new Error('disk full') } }
          },
        })), options)
      },
    })
    const brokenStore = createEnvelopeSecretStore({ db: failingDb, env: ENV })
    const result = await brokenStore.revoke({ ...scope, reason: 'owner revoked' })
    expect(result).toMatchObject({ credentialStatus: 'REVOKED', purgedCount: 0, purgeFailedCount: 1 })
    expect((await credentialOf(scope.connectionId)).versions.map(v => v.status)).toEqual(['REVOKED'])
    expect(await envelopeCount(scope.connectionId)).toBe(1)
    // The reconciler is another revoke: it retries purging what is still REVOKED.
    expect(await store.revoke({ ...scope, reason: 'reconcile' })).toMatchObject({ purgedCount: 1, purgeFailedCount: 0 })
    expect(await envelopeCount(scope.connectionId)).toBe(0)
  })

  it('compensation purges a stored version whose follow-up failed, and records what it did', async () => {
    const { scope } = await newConnection()
    const compensations = []
    const error = await storeValidatedCredential({
      store, ...scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK',
      afterActivate: async () => { throw new Error('account row failed') },
      onCompensation: async (outcome) => compensations.push(outcome),
    }).catch(e => e)
    expect(error).toMatchObject({ code: 'CREDENTIAL_ORPHAN_PURGED', status: 500 })
    expect(compensations).toEqual([{ outcome: 'CREDENTIAL_ORPHAN_PURGED', purgedCount: 1, purgeFailedCount: 0, versionNumber: 1 }])
    expect((await credentialOf(scope.connectionId)).status).toBe('REVOKED')
    expect(await envelopeCount(scope.connectionId)).toBe(0)

    // An activation that fails rejects the pending version instead.
    const again = await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: bundle(), validationCode: 'not a code' }).catch(e => e)
    expect(again).toMatchObject({ code: 'CREDENTIAL_ORPHAN_PURGED' })
    expect(await envelopeCount(scope.connectionId)).toBe(0)
  })

  it('a restored credential needs re-entry: it stops resolving and the next write replaces it', async () => {
    const { scope, destination } = await newConnection()
    const v1 = await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
    expect(await markCredentialsReentryRequired(prisma, { connectionIds: [scope.connectionId] })).toBe(1)
    await expect(manager.resolve(v1.secretRef, { ...scope, destination })).rejects.toMatchObject({ code: 'NotFound' })
    const fresh = bundle({ withToken: true })
    const v3 = await store.write({ ...scope, kind: 'LINE_CHANNEL', bundle: fresh, createdVia: 'BROWSER_MFA' })
    expect(await credentialOf(scope.connectionId)).toMatchObject({ status: 'PENDING_VALIDATION', secretRef: v3.secretRef })
    await store.activate({ ...scope, versionNumber: v3.versionNumber, validationCode: 'LINE_OK' })
    expect(JSON.parse((await manager.resolve(v3.secretRef, { ...scope, destination })).material)).toEqual(fresh)
  })

  it('a mount-backed credential moves into the store on re-entry, with a BACKFILL version for the mount', async () => {
    const { connection, scope } = await newConnection()
    await prisma.integrationCredential.create({ data: { connectionId: connection.id, secretRef: 'deployment-secret:legacy', status: 'ACTIVE' } })
    const moved = await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
    const credential = await credentialOf(scope.connectionId)
    expect(credential).toMatchObject({ status: 'ACTIVE', secretStore: 'ENVELOPE', secretRef: moved.secretRef, version: 2 })
    expect(credential.versions.map(v => [v.versionNumber, v.status, v.createdVia, v.reason])).toEqual([
      [1, 'SUPERSEDED', 'BACKFILL', 'MATERIAL_OUTSIDE_THIS_STORE'],
      [2, 'ACTIVE', 'BROWSER_MFA', null],
    ])
  })

  it('the LINE runtime resolves a vault-backed account, including mid-rotation', async () => {
    const { connection, scope } = await newConnection()
    const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
    const account = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: connection.id, code: `oa-vault-${randomBytes(3).toString('hex')}`, displayName: 'Vault' }, { viewer: owner })
    const live = bundle({ withToken: true })
    await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: live, validationCode: 'LINE_OK' })
    await store.write({ ...scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), createdVia: 'BROWSER_MFA' })
    const resolved = await resolveServerLineAccount({ accountId: account.id, db: prisma, secretManager: manager, requireEnabled: false })
    expect(resolved.channelSecret).toBe(live.channelSecret)
    expect(resolved.channelAccessToken).toBe(live.channelAccessToken)
    expect(JSON.stringify(resolved)).not.toContain(live.channelSecret)
  })

  it('revocation fences the LINE OA account before the store purges, and the runtime stops resolving it', async () => {
    const { connection, scope } = await newConnection()
    const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
    const account = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: connection.id, code: `oa-fence-${randomBytes(3).toString('hex')}`, displayName: 'Fence' }, { viewer: owner })
    await storeValidatedCredential({ store, ...scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
    await prisma.lineOaAccount.update({ where: { id: account.id }, data: { serverEnabled: true, status: 'CONNECTED' } })
    const before = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })

    const result = await revokeCredential({
      store, ...scope, reason: 'owner revoked',
      fence: async (fenceScope) => {
        const fenced = await fenceLineOaAccountForCredentialRevocation({ ...fenceScope, actorId: 'person-1' })
        expect((await credentialOf(scope.connectionId)).status).toBe('ACTIVE')
        return fenced
      },
    })
    expect(result.credentialStatus).toBe('REVOKED')
    const after = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
    expect(after).toMatchObject({ serverEnabled: false, transportEpoch: before.transportEpoch + 1, version: before.version + 1 })
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: account.id, action: 'LINE_OA_ACCOUNT_CREDENTIAL_REVOKED_FENCED' } })
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ to: { serverEnabled: false }, cancelledTransportJobs: 0 })
    await expect(resolveServerLineAccount({ accountId: account.id, db: prisma, secretManager: manager, requireEnabled: false })).rejects.toThrow('LINE_ACCOUNT_CREDENTIAL_UNAVAILABLE')
    expect(await fenceLineOaAccountForCredentialRevocation({ ...scope, connectionId: randomUUID() })).toEqual({ fenced: false })
  })

  it('leaves no material in any Prisma column, audit row, backup export, log line or error (proof 1)', async () => {
    const { scope } = await newConnection()
    const leaked = bundle({ withToken: true })
    const { output, error } = await captureConsole(async () => {
      const stored = await storeValidatedCredential({
        store, ...scope, kind: 'LINE_CHANNEL', bundle: leaked, validationCode: 'LINE_OK',
        afterActivate: async (result) => recordAudit(prisma, {
          entityType: 'INTEGRATION_CREDENTIAL', entityId: scope.connectionId, action: 'CREDENTIAL_WRITTEN',
          payload: credentialAuditPayload({ businessId: scope.businessId, connectionId: scope.connectionId, credentialVersion: result.versionNumber, secretStore: 'ENVELOPE', validationCode: 'LINE_OK', via: 'BROWSER_MFA' }),
        }),
      })
      await store.write({ ...scope, tenantId: otherBusiness.tenantId, kind: 'LINE_CHANNEL', bundle: leaked, createdVia: 'BROWSER_MFA' }).catch(e => { console.error(e) })
      console.log('stored', stored)
      return stored
    })
    expect(error).toBeUndefined()
    const needles = [...new Set(allBundles.flatMap(secretNeedles))]
    const snapshot = await exportSnapshot({ db: prisma })
    expect(snapshot.tables.integrationSecretEnvelope).toBeUndefined()
    expect(snapshot.tables.integrationCredentialVersion.length).toBeGreaterThan(0)
    const tables = {
      integrationCredential: await prisma.integrationCredential.findMany(),
      integrationCredentialVersion: await prisma.integrationCredentialVersion.findMany(),
      integrationSecretEnvelope: await prisma.integrationSecretEnvelope.findMany(),
      integrationConnection: await prisma.integrationConnection.findMany(),
      auditEvent: await prisma.auditEvent.findMany(),
      lineOaAccount: await prisma.lineOaAccount.findMany(),
    }
    expect(findLeaks({ ...tables, snapshot, output }, needles)).toEqual([])
    const refusal = await store.write({ ...scope, businessId: otherBusiness.id, kind: 'LINE_CHANNEL', bundle: leaked, createdVia: 'BROWSER_MFA' }).catch(e => e)
    expect(findLeaks({ refusal: errorTrace(refusal) }, needles)).toEqual([])
  })
})
