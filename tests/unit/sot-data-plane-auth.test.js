import { describe, it, expect, beforeAll } from 'vitest'

import prisma from '@/lib/db'
import { createPortfolio, createTenant } from '../factories/scope'
import {
  SOT_DATA_PLANE_KEY_PREFIX,
  mintSotDataPlaneKey,
  resolveSotDataPlaneViewer,
  revokeSotDataPlaneKey,
} from '@/modules/identity/sot-data-plane-auth'

// @req FR-102 — a bearer credential scoped to exactly one Tenant lets the SoT
// pipeline's external data plane authenticate to the FR-100 decision
// submit/export endpoints without a browser session or a Person identity.
// @spec ADR-047, SEC-019
// @tested tests/unit/sot-data-plane-auth.test.js

let tenant, otherTenant

beforeAll(async () => {
  const pf = await createPortfolio({ name: 'SoT Data Plane Group', code: 'PF-SDPK' })
  tenant = await createTenant({ portfolioId: pf.id, name: 'SoT Data Plane Tenant', code: 'TNT-SDPK' })
  otherTenant = await createTenant({ portfolioId: pf.id, name: 'SoT Data Plane Other Tenant', code: 'TNT-SDPK-2' })
})

function bearerRequest(token) {
  return { headers: { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) } }
}

describe('FR-102 mintSotDataPlaneKey', () => {
  it('mints a key that never stores the raw secret', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'smartgift-connector', tenantId: tenant.id })
    expect(minted.key.startsWith(`${SOT_DATA_PLANE_KEY_PREFIX}_`)).toBe(true)
    expect(minted.tenantId).toBe(tenant.id)
    expect(minted.label).toBe('smartgift-connector')

    const row = await prisma.sotDataPlaneKey.findUnique({ where: { id: minted.id } })
    expect(row.keyHash).not.toBe(minted.key)
    expect(row.status).toBe('ACTIVE')
    // The row keeps enough of a prefix to identify the key in an admin list,
    // never enough to reconstruct it.
    expect(minted.key.startsWith(row.keyPrefix)).toBe(true)
    expect(row.keyPrefix.length).toBeLessThan(minted.key.length)
  })

  it('requires a label and a tenantId', async () => {
    await expect(mintSotDataPlaneKey({ tenantId: tenant.id })).rejects.toThrow(/label/i)
    await expect(mintSotDataPlaneKey({ label: 'x' })).rejects.toThrow(/tenant/i)
  })

  it('two mints never collide on the same secret', async () => {
    const a = await mintSotDataPlaneKey({ label: 'a', tenantId: tenant.id })
    const b = await mintSotDataPlaneKey({ label: 'b', tenantId: tenant.id })
    expect(a.key).not.toBe(b.key)
  })
})

describe('FR-102 resolveSotDataPlaneViewer', () => {
  it('resolves a viewer scoped to the key\'s bound tenant for a valid bearer token', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'resolve-ok', tenantId: tenant.id })
    const viewer = await resolveSotDataPlaneViewer(bearerRequest(minted.key))
    expect(viewer).toEqual({ isSotDataPlane: true, tenantId: tenant.id, serviceAccountId: minted.id })
  })

  it('is null when no Authorization header is present (falls through to session auth)', async () => {
    const viewer = await resolveSotDataPlaneViewer({ headers: { get: () => null } })
    expect(viewer).toBeNull()
  })

  it('is null for an Authorization header that is not a sdpk_ bearer token', async () => {
    const viewer = await resolveSotDataPlaneViewer(bearerRequest('zuri_sess.abc.def'))
    expect(viewer).toBeNull()
  })

  it('is null for a well-formed but unknown key', async () => {
    const viewer = await resolveSotDataPlaneViewer(bearerRequest(`${SOT_DATA_PLANE_KEY_PREFIX}_doesnotexist`))
    expect(viewer).toBeNull()
  })

  it('is null once the key is revoked, with no grace period', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'revoke-me', tenantId: tenant.id })
    expect(await resolveSotDataPlaneViewer(bearerRequest(minted.key))).not.toBeNull()

    const revoked = await revokeSotDataPlaneKey(minted.id, { reason: 'rotated' })
    expect(revoked).toBe(true)

    expect(await resolveSotDataPlaneViewer(bearerRequest(minted.key))).toBeNull()
  })

  it('never lets a key from one Tenant resolve into another Tenant\'s scope', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'tenant-bound', tenantId: tenant.id })
    const viewer = await resolveSotDataPlaneViewer(bearerRequest(minted.key))
    expect(viewer.tenantId).toBe(tenant.id)
    expect(viewer.tenantId).not.toBe(otherTenant.id)
  })

  it('records lastUsedAt on a successful resolution', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'last-used', tenantId: tenant.id })
    const before = await prisma.sotDataPlaneKey.findUnique({ where: { id: minted.id } })
    expect(before.lastUsedAt).toBeNull()

    await resolveSotDataPlaneViewer(bearerRequest(minted.key))

    const after = await prisma.sotDataPlaneKey.findUnique({ where: { id: minted.id } })
    expect(after.lastUsedAt).not.toBeNull()
  })
})

describe('FR-102 revokeSotDataPlaneKey', () => {
  it('is a no-op for an already-revoked or unknown id', async () => {
    const minted = await mintSotDataPlaneKey({ label: 'double-revoke', tenantId: tenant.id })
    expect(await revokeSotDataPlaneKey(minted.id)).toBe(true)
    expect(await revokeSotDataPlaneKey(minted.id)).toBe(false)
    expect(await revokeSotDataPlaneKey('does-not-exist')).toBe(false)
  })
})
