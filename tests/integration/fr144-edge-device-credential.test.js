// @req FR-144 — the Business-scoped credential a Zuri Edge Device presents.
// @spec SEC-025, SEC-001, ADR-059 D2, ADR-041 D3
// @tested tests/integration/fr144-edge-device-credential.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  EDGE_DEVICE_KEY_PREFIX,
  listEdgeDeviceCredentials,
  mintEdgeDeviceCredential,
  resolveEdgeDeviceContext,
  revokeEdgeDeviceCredential,
} from '@/modules/identity/edge-device-credential'

let tenant, business, otherBusiness, owner, member, foreignOwner

const bearer = (key) => ({ headers: { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${key}` : null) } })

describe('FR-144 edge device credential', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-EDGE-CRED', name: 'Edge Credential Group' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-EDGE-CRED', name: 'Edge Credential Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-EDGE-CRED', name: 'Edge Credential Business' })
    otherBusiness = await createBusiness({ tenantId: tenant.id, code: 'BUS-EDGE-CRED-2', name: 'Second Business' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    member = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [] })
    foreignOwner = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })
  })

  it('AC-144.1 — mint returns the raw key exactly once and stores only its hash', async () => {
    const { credential, key } = await mintEdgeDeviceCredential({ businessId: business.id, deviceId: 'DEV-A', label: 'Front desk node', viewer: owner })
    expect(key.startsWith(`${EDGE_DEVICE_KEY_PREFIX}_`)).toBe(true)
    expect(credential).toMatchObject({ deviceId: 'DEV-A', label: 'Front desk node', status: 'ACTIVE', businessId: business.id })
    expect(Object.keys(credential)).not.toContain('keyHash')

    const stored = await prisma.edgeDeviceCredential.findUnique({ where: { id: credential.id } })
    expect(stored.keyHash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.keyHash).not.toBe(key)
    // The listing never carries the key again, in any field.
    const { credentials } = await listEdgeDeviceCredentials({ businessId: business.id, viewer: owner })
    expect(JSON.stringify(credentials)).not.toContain(key)
    expect(credentials[0].keyPrefix.length).toBeLessThan(key.length)
  })

  it('AC-144.6 — mint and revoke each record exactly one audit event, with no key material', async () => {
    const { credential, key } = await mintEdgeDeviceCredential({ businessId: business.id, deviceId: 'DEV-AUDIT', label: 'Audited node', viewer: owner })
    const minted = await prisma.auditEvent.findMany({ where: { entityId: credential.id, action: 'EDGE_DEVICE_CREDENTIAL_MINTED' } })
    expect(minted).toHaveLength(1)
    expect(minted[0].payloadJson).not.toContain(key)
    expect(minted[0].payloadJson).not.toContain(credential.keyPrefix)

    await revokeEdgeDeviceCredential(credential.id, { reason: 'Device retired', viewer: owner })
    const revoked = await prisma.auditEvent.findMany({ where: { entityId: credential.id, action: 'EDGE_DEVICE_CREDENTIAL_REVOKED' } })
    expect(revoked).toHaveLength(1)
    // Revoking twice is not a second event: the conditional update matched nothing.
    await revokeEdgeDeviceCredential(credential.id, { viewer: owner })
    expect(await prisma.auditEvent.count({ where: { entityId: credential.id, action: 'EDGE_DEVICE_CREDENTIAL_REVOKED' } })).toBe(1)
  })

  it('AC-144.2 — a Business the caller does not own answers exactly as an unknown one', async () => {
    const refusals = []
    for (const viewer of [member, foreignOwner]) {
      await expect(
        mintEdgeDeviceCredential({ businessId: business.id, deviceId: 'DEV-X', label: 'X', viewer }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(listEdgeDeviceCredentials({ businessId: business.id, viewer })).rejects.toMatchObject({ status: 404 })
    }
    await mintEdgeDeviceCredential({ businessId: business.id, deviceId: 'DEV-FAKE-CHECK', label: 'L', viewer: owner })
    await listEdgeDeviceCredentials({ businessId: 'does-not-exist', viewer: owner }).catch((error) => refusals.push(error))
    expect(refusals[0]).toMatchObject({ status: 404, message: 'Business not found' })
  })

  it('AC-144.3/.4 — an active key resolves and touches lastUsedAt; every other shape resolves to null', async () => {
    const { credential, key } = await mintEdgeDeviceCredential({ businessId: business.id, deviceId: 'DEV-RESOLVE', label: 'Resolver node', viewer: owner })
    const before = await prisma.edgeDeviceCredential.findUnique({ where: { id: credential.id } })
    expect(before.lastUsedAt).toBeNull()

    const context = await resolveEdgeDeviceContext(bearer(key))
    expect(context).toMatchObject({
      isEdgeDevice: true, deviceId: 'DEV-RESOLVE', businessId: business.id, tenantId: tenant.id, credentialId: credential.id,
    })
    // Not a viewer: nothing here can satisfy an ownership or visibility check.
    expect(context.principal).toBeUndefined()
    expect(context.ownedBusinessIds).toBeUndefined()

    const after = await prisma.edgeDeviceCredential.findUnique({ where: { id: credential.id } })
    expect(after.lastUsedAt).not.toBeNull()

    for (const request of [
      { headers: { get: () => null } },
      bearer('apik_some-other-family'),
      bearer(`${EDGE_DEVICE_KEY_PREFIX}_never-minted`),
      { headers: { get: () => 'Basic abc' } },
    ]) {
      expect(await resolveEdgeDeviceContext(request)).toBeNull()
    }
  })

  it('AC-144.5 — revocation takes effect on the very next request', async () => {
    const { credential, key } = await mintEdgeDeviceCredential({ businessId: business.id, deviceId: 'DEV-REVOKE', label: 'Short-lived node', viewer: owner })
    expect(await resolveEdgeDeviceContext(bearer(key))).not.toBeNull()
    await revokeEdgeDeviceCredential(credential.id, { reason: 'Stolen', viewer: owner })
    // Same key, next call: indistinguishable from a key that never existed.
    expect(await resolveEdgeDeviceContext(bearer(key))).toBeNull()
    const row = await prisma.edgeDeviceCredential.findUnique({ where: { id: credential.id } })
    expect(row).toMatchObject({ status: 'REVOKED', revokeReason: 'Stolen' })
    expect(row.revokedAt).not.toBeNull()
  })

  it('a revoked credential still appears in the listing, so the operator can see what was withdrawn', async () => {
    const { credentials } = await listEdgeDeviceCredentials({ businessId: business.id, viewer: owner })
    expect(credentials.some((row) => row.status === 'REVOKED')).toBe(true)
    expect(credentials.every((row) => row.businessId === business.id)).toBe(true)
  })

  it('refuses an incomplete mint before it touches the database', async () => {
    for (const input of [
      { businessId: '', deviceId: 'D', label: 'L' },
      { businessId: business.id, deviceId: '  ', label: 'L' },
      { businessId: business.id, deviceId: 'D', label: '' },
    ]) {
      await expect(mintEdgeDeviceCredential({ ...input, viewer: owner })).rejects.toMatchObject({ status: 400 })
    }
  })
})
