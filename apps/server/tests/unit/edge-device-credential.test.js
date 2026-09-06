// @req FR-144 — the credential module's decisions, with the database injected.
// @spec SEC-025, BR-002, ADR-059 D2
// @tested tests/unit/edge-device-credential.test.js
import { describe, expect, it, vi } from 'vitest'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  EDGE_DEVICE_KEY_PREFIX,
  listEdgeDeviceCredentials,
  mintEdgeDeviceCredential,
  resolveEdgeDeviceContext,
} from '@/modules/identity/edge-device-credential'

const owner = makeViewer({ visibleBusinessIds: ['bus-1'], ownedBusinessIds: ['bus-1'] })
const member = makeViewer({ visibleBusinessIds: ['bus-1'], ownedBusinessIds: [] })
const elsewhere = ownsElsewhere({ owns: 'bus-2', sees: 'bus-1' })

/** A db that fails the test if the module touches it at all. */
const untouchable = new Proxy({}, {
  get(_target, model) {
    return new Proxy({}, { get() { return () => { throw new Error(`the module queried ${String(model)} before deciding authority`) } } })
  },
})

describe('FR-144 edge device credential decisions', () => {
  it('keeps the key family distinct from the Enterprise API one', () => {
    // A device key and an ApiAccessKey are different scopes (Business vs Tenant).
    // The prefixes must not collide, or one resolver would silently see the other.
    expect(EDGE_DEVICE_KEY_PREFIX).toBe('edgk')
    expect(EDGE_DEVICE_KEY_PREFIX).not.toBe('apik')
  })

  it('decides authority before it touches the database', async () => {
    for (const viewer of [member, elsewhere, undefined]) {
      await expect(
        mintEdgeDeviceCredential({ businessId: 'bus-1', deviceId: 'D', label: 'L', viewer, db: untouchable }),
      ).rejects.toMatchObject({ status: 404, message: 'Business not found' })
      await expect(
        listEdgeDeviceCredentials({ businessId: 'bus-1', viewer, db: untouchable }),
      ).rejects.toMatchObject({ status: 404, message: 'Business not found' })
    }
  })

  it('validates the request before it touches the database', async () => {
    for (const input of [
      { businessId: '', deviceId: 'D', label: 'L' },
      { businessId: 'bus-1', deviceId: '', label: 'L' },
      { businessId: 'bus-1', deviceId: 'D', label: '   ' },
    ]) {
      await expect(mintEdgeDeviceCredential({ ...input, viewer: owner, db: untouchable }))
        .rejects.toMatchObject({ status: 400 })
    }
  })

  it('refuses every non-device authorization shape without a query', async () => {
    const db = { edgeDeviceCredential: { findUnique: vi.fn(), updateMany: vi.fn() } }
    const headers = (value) => ({ headers: { get: () => value } })
    for (const request of [
      headers(null),
      headers('Basic abcdef'),
      headers('Bearer apik_enterprise-key'),
      headers('Bearer sbp_something'),
      headers('Bearer'),
      {},
    ]) {
      expect(await resolveEdgeDeviceContext(request, { db })).toBeNull()
    }
    // None of those reached the database: a wrong-family token is not a lookup.
    expect(db.edgeDeviceCredential.findUnique).not.toHaveBeenCalled()
  })

  it('refuses a revoked credential exactly as it refuses one that never existed', async () => {
    const revoked = { edgeDeviceCredential: { findUnique: async () => ({ id: 'c1', status: 'REVOKED', deviceId: 'D', businessId: 'b', tenantId: 't' }), updateMany: vi.fn() } }
    const missing = { edgeDeviceCredential: { findUnique: async () => null, updateMany: vi.fn() } }
    const request = { headers: { get: () => `Bearer ${EDGE_DEVICE_KEY_PREFIX}_whatever` } }
    expect(await resolveEdgeDeviceContext(request, { db: revoked })).toBeNull()
    expect(await resolveEdgeDeviceContext(request, { db: missing })).toBeNull()
    // Neither wrote anything — a failed resolution leaves no trace to time.
    expect(revoked.edgeDeviceCredential.updateMany).not.toHaveBeenCalled()
    expect(missing.edgeDeviceCredential.updateMany).not.toHaveBeenCalled()
  })

  it('returns a device context, never something a viewer check could accept', async () => {
    const db = {
      edgeDeviceCredential: {
        findUnique: async () => ({ id: 'c1', status: 'ACTIVE', deviceId: 'DEV-1', businessId: 'bus-9', tenantId: 'tnt-9' }),
        updateMany: async () => ({ count: 1 }),
      },
    }
    const context = await resolveEdgeDeviceContext({ headers: { get: () => `Bearer ${EDGE_DEVICE_KEY_PREFIX}_x` } }, { db })
    expect(context).toEqual({ isEdgeDevice: true, credentialId: 'c1', deviceId: 'DEV-1', businessId: 'bus-9', tenantId: 'tnt-9' })
    // The fields an authorization predicate reads are absent, so passing this
    // where a viewer belongs fails closed instead of granting anything.
    for (const field of ['principal', 'ownedBusinessIds', 'visibleBusinessIds', 'isOperator', 'isPlatform', 'role']) {
      expect(context[field]).toBeUndefined()
    }
  })
})
