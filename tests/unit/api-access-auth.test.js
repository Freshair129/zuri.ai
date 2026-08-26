import { describe, it, expect, beforeAll } from 'vitest'

import prisma from '@/lib/db'
import { createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import {
  API_ACCESS_KEY_PREFIX,
  mintApiAccessKey,
  resolveApiAccessViewer,
  revokeApiAccessKey,
} from '@/modules/identity/api-access-auth'
import { isApiAccessFor } from '@/modules/identity/viewer-authority'

// @req FR-106 — a bearer credential scoped to exactly one Tenant lets an
// enterprise integrator authenticate to the FR-019 Enterprise API without a
// browser session or a Person identity. Minting/revoking is an authenticated
// authority (operator or Tenant owner) and is audited without token material.
// @spec SEC-006, SEC-001, BR-002, ADR-047
// @tested tests/unit/api-access-auth.test.js

let tenant, otherTenant
const operator = () => makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
const tenantOwner = (tenantId) =>
  makeViewer({ role: 'OWNER', visibleBusinessIds: [], ownedBusinessIds: [], ownedTenantIds: [tenantId] })

beforeAll(async () => {
  const pf = await createPortfolio({ name: 'API Access Key Group', code: 'PF-APIK' })
  tenant = await createTenant({ portfolioId: pf.id, name: 'API Access Key Tenant', code: 'TNT-APIK' })
  otherTenant = await createTenant({ portfolioId: pf.id, name: 'API Access Key Other Tenant', code: 'TNT-APIK-2' })
})

function bearerRequest(token) {
  return { headers: { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) } }
}

describe('FR-106 mintApiAccessKey', () => {
  it('the installation operator mints a key that never stores the raw secret', async () => {
    const minted = await mintApiAccessKey({ label: 'erp-connector', tenantId: tenant.id, viewer: operator() })
    expect(minted.key.startsWith(`${API_ACCESS_KEY_PREFIX}_`)).toBe(true)
    expect(minted.tenantId).toBe(tenant.id)
    expect(minted.label).toBe('erp-connector')

    const row = await prisma.apiAccessKey.findUnique({ where: { id: minted.id } })
    expect(row.keyHash).not.toBe(minted.key)
    expect(row.status).toBe('ACTIVE')
    // Enough of a prefix to identify the key in an admin list, never enough to
    // reconstruct it.
    expect(minted.key.startsWith(row.keyPrefix)).toBe(true)
    expect(row.keyPrefix.length).toBeLessThan(minted.key.length)
  })

  it('an owner in that Tenant mints (FR-074(b)); an owner of another Tenant cannot', async () => {
    const minted = await mintApiAccessKey({ label: 'own-tenant', tenantId: tenant.id, viewer: tenantOwner(tenant.id) })
    expect(minted.tenantId).toBe(tenant.id)

    await expect(
      mintApiAccessKey({ label: 'cross-tenant', tenantId: tenant.id, viewer: tenantOwner(otherTenant.id) })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('an ordinary member (and a per-Business owner) cannot mint — the scope is Tenant-wide', async () => {
    await expect(
      mintApiAccessKey({ label: 'member', tenantId: tenant.id, viewer: makeViewer() })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      mintApiAccessKey({ label: 'biz-owner', tenantId: tenant.id, viewer: makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] }) })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('authority is checked before Tenant existence — an unauthorized caller learns nothing', async () => {
    await expect(
      mintApiAccessKey({ label: 'probe', tenantId: 'no-such-tenant', viewer: makeViewer() })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      mintApiAccessKey({ label: 'probe', tenantId: 'no-such-tenant', viewer: operator() })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('requires a label and a tenantId', async () => {
    await expect(mintApiAccessKey({ tenantId: tenant.id, viewer: operator() })).rejects.toThrow(/LABEL/i)
    await expect(mintApiAccessKey({ label: 'x', viewer: operator() })).rejects.toThrow(/TENANT/i)
  })

  it('audits the mint without any token material', async () => {
    const minted = await mintApiAccessKey({ label: 'audited-mint', tenantId: tenant.id, viewer: operator() })
    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'ApiAccessKey', entityId: minted.id, action: 'API_ACCESS_KEY_MINTED' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].payloadJson).toContain(tenant.id)
    expect(events[0].payloadJson).not.toContain(minted.key)
    const row = await prisma.apiAccessKey.findUnique({ where: { id: minted.id } })
    expect(events[0].payloadJson).not.toContain(row.keyHash)
    expect(events[0].payloadJson).not.toContain(row.keyPrefix)
  })

  it('two mints never collide on the same secret', async () => {
    const a = await mintApiAccessKey({ label: 'a', tenantId: tenant.id, viewer: operator() })
    const b = await mintApiAccessKey({ label: 'b', tenantId: tenant.id, viewer: operator() })
    expect(a.key).not.toBe(b.key)
  })
})

describe('FR-106 resolveApiAccessViewer', () => {
  it('resolves a viewer scoped to the key\'s bound tenant for a valid bearer token', async () => {
    const minted = await mintApiAccessKey({ label: 'resolve-ok', tenantId: tenant.id, viewer: operator() })
    const viewer = await resolveApiAccessViewer(bearerRequest(minted.key))
    expect(viewer).toEqual({ isApiAccess: true, tenantId: tenant.id, serviceAccountId: minted.id })
    expect(isApiAccessFor(viewer, tenant.id)).toBe(true)
    expect(isApiAccessFor(viewer, otherTenant.id)).toBe(false)
  })

  it('is null when no Authorization header is present (falls through to session auth)', async () => {
    expect(await resolveApiAccessViewer({ headers: { get: () => null } })).toBeNull()
  })

  it('is null for an Authorization header that is not an apik_ bearer token', async () => {
    expect(await resolveApiAccessViewer(bearerRequest('zuri_sess.abc.def'))).toBeNull()
    expect(await resolveApiAccessViewer(bearerRequest('sdpk_not_this_key_type'))).toBeNull()
  })

  it('is null for a well-formed but unknown key', async () => {
    expect(await resolveApiAccessViewer(bearerRequest(`${API_ACCESS_KEY_PREFIX}_doesnotexist`))).toBeNull()
  })

  it('is null once the key is revoked, with no grace period', async () => {
    const minted = await mintApiAccessKey({ label: 'revoke-me', tenantId: tenant.id, viewer: operator() })
    expect(await resolveApiAccessViewer(bearerRequest(minted.key))).not.toBeNull()

    const result = await revokeApiAccessKey(minted.id, { reason: 'rotated', viewer: operator() })
    expect(result.revoked).toBe(true)

    expect(await resolveApiAccessViewer(bearerRequest(minted.key))).toBeNull()
  })

  it('records lastUsedAt on a successful resolution', async () => {
    const minted = await mintApiAccessKey({ label: 'last-used', tenantId: tenant.id, viewer: operator() })
    expect((await prisma.apiAccessKey.findUnique({ where: { id: minted.id } })).lastUsedAt).toBeNull()

    await resolveApiAccessViewer(bearerRequest(minted.key))

    expect((await prisma.apiAccessKey.findUnique({ where: { id: minted.id } })).lastUsedAt).not.toBeNull()
  })

  it('never resolves an isOperator or Person-shaped viewer', async () => {
    const minted = await mintApiAccessKey({ label: 'not-operator', tenantId: tenant.id, viewer: operator() })
    const viewer = await resolveApiAccessViewer(bearerRequest(minted.key))
    expect(viewer.isOperator).toBeUndefined()
    expect(viewer.principal).toBeUndefined()
    expect(viewer.ownedBusinessIds).toBeUndefined()
  })
})

describe('FR-106 revokeApiAccessKey', () => {
  it('the Tenant owner revokes; the revocation is audited without token material', async () => {
    const minted = await mintApiAccessKey({ label: 'owner-revoke', tenantId: tenant.id, viewer: operator() })
    const result = await revokeApiAccessKey(minted.id, { reason: 'compromised', viewer: tenantOwner(tenant.id) })
    expect(result).toEqual({ id: minted.id, revoked: true })

    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'ApiAccessKey', entityId: minted.id, action: 'API_ACCESS_KEY_REVOKED' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].payloadJson).toContain('compromised')
    expect(events[0].payloadJson).not.toContain(minted.key)
  })

  it('an unknown id and a key outside the viewer\'s authority answer identically (404)', async () => {
    const minted = await mintApiAccessKey({ label: 'not-yours', tenantId: tenant.id, viewer: operator() })
    let unknownError, unauthorizedError
    await revokeApiAccessKey('does-not-exist', { viewer: tenantOwner(otherTenant.id) }).catch((e) => { unknownError = e })
    await revokeApiAccessKey(minted.id, { viewer: tenantOwner(otherTenant.id) }).catch((e) => { unauthorizedError = e })
    expect(unknownError?.status).toBe(404)
    expect(unauthorizedError?.status).toBe(404)
    expect(unauthorizedError?.message).toBe(unknownError?.message)
    // And the key is still active — the refusal changed nothing.
    expect((await prisma.apiAccessKey.findUnique({ where: { id: minted.id } })).status).toBe('ACTIVE')
  })

  it('revoking an already-revoked key reports revoked:false and audits nothing new', async () => {
    const minted = await mintApiAccessKey({ label: 'double-revoke', tenantId: tenant.id, viewer: operator() })
    expect((await revokeApiAccessKey(minted.id, { viewer: operator() })).revoked).toBe(true)
    expect((await revokeApiAccessKey(minted.id, { viewer: operator() })).revoked).toBe(false)
    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'ApiAccessKey', entityId: minted.id, action: 'API_ACCESS_KEY_REVOKED' },
    })
    expect(events).toHaveLength(1)
  })
})
