import { describe, expect, it, vi } from 'vitest'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  LINE_REGISTRY_TYPES,
  listLineRegistry,
  saveLineGroup,
  saveLineUser,
} from '@/modules/integration/application/line-registry-service'

// @req FR-080 — Platform Integration metadata management for LINE channels and contacts
// @spec ADR-032, SEC-016, SDD-044, SEC-001
// @tested tests/unit/line-registry-service.test.js
//
// This suite used to build `{ id, personId, isPlatformDev: true }` by hand and
// assert only two Zod messages, so every test failed before it reached a single
// line of persistence or authorization code — which is why a cross-tenant read
// leak and a cross-Business ownership takeover both sat here unnoticed
// (D2-domain-integration-verifier-30). Viewers now come from the factory, and
// the persistence path is proven against a real database in
// tests/integration/line-registry-scope.test.js.

const OWNED = 'b-owned'
const owner = () => makeViewer({ visibleBusinessIds: [OWNED], ownedBusinessIds: [OWNED] })

/** A db double that fails loudly if the guard let a query through. */
function spyDb() {
  return {
    integrationConnection: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async () => { throw new Error('transaction must not be reached') }),
  }
}

describe('LINE Registry Service (Groups and Users)', () => {
  it('validates LINE group ID format (must start with C)', async () => {
    await expect(saveLineGroup({
      businessId: OWNED,
      name: 'Sales Team',
      groupId: 'U123456789', // Invalid: starts with U instead of C
      departmentType: 'SALES_TEAM',
    }, { resolve: () => owner(), db: spyDb() })).rejects.toThrow('LINE Group ID must start with C')
  })

  it('validates LINE user ID format (must start with U)', async () => {
    await expect(saveLineUser({
      businessId: OWNED,
      displayName: 'Somchai Sales',
      userId: 'C123456789', // Invalid: starts with C instead of U
    }, { resolve: () => owner(), db: spyDb() })).rejects.toThrow('LINE User ID must start with U')
  })

  it('refuses a save into a Business the viewer merely sees, before any write', async () => {
    const db = spyDb()
    await expect(saveLineGroup({
      businessId: 'b-target',
      name: 'Their Sales Team',
      groupId: 'Cabcdef',
    }, { resolve: () => ownsElsewhere(), db })).rejects.toMatchObject({ status: 404 })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('refuses a listing of a Business the viewer merely sees, before any query', async () => {
    const db = spyDb()
    await expect(listLineRegistry({
      businessId: 'b-target',
      resolve: () => ownsElsewhere(),
      db,
    })).rejects.toMatchObject({ status: 404 })
    expect(db.integrationConnection.findMany).not.toHaveBeenCalled()
  })

  it('returns an empty list, and queries nothing, for a viewer who owns no Business', async () => {
    const db = spyDb()
    const rows = await listLineRegistry({
      resolve: () => makeViewer({ role: 'MEMBER', visibleBusinessIds: ['b-1'], ownedBusinessIds: [] }),
      db,
    })
    expect(rows).toEqual([])
    expect(db.integrationConnection.findMany).not.toHaveBeenCalled()
  })

  it('scopes an unfiltered listing to the owned Businesses and to registry rows only', async () => {
    const db = spyDb()
    await listLineRegistry({ resolve: () => owner(), db })
    const where = db.integrationConnection.findMany.mock.calls[0][0].where
    expect(where.businessId).toEqual({ in: [OWNED] })
    expect(where.purpose).toEqual({ in: [LINE_REGISTRY_TYPES.GROUP, LINE_REGISTRY_TYPES.USER] })
    // Reads tolerate the legacy lowercase provider code; writes no longer emit it.
    expect(where.provider.code.in).toEqual(expect.arrayContaining(['LINE_OA', 'line-oa']))
  })

  it('no longer honours the isPlatformDev / isLocalDev flags no resolver emits', async () => {
    // Adversarial input rather than a fixture: a factory viewer that owns
    // nothing, carrying the two flags the removed escape hatch used to look for.
    // If the hatch ever came back, this viewer would be the one to slip through.
    const forged = () => ({
      ...makeViewer({ role: 'MEMBER', visibleBusinessIds: ['b-1'], ownedBusinessIds: [] }),
      isPlatformDev: true,
      isLocalDev: true,
    })
    const db = spyDb()

    await expect(listLineRegistry({ businessId: 'b-1', resolve: forged, db }))
      .rejects.toMatchObject({ status: 404 })
    await expect(listLineRegistry({ resolve: forged, db })).resolves.toEqual([])
    await expect(saveLineGroup({
      businessId: 'b-1',
      name: 'Forged',
      groupId: 'Cforged',
    }, { resolve: forged, db })).rejects.toMatchObject({ status: 404 })
    expect(db.integrationConnection.findMany).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('surfaces an audit failure instead of swallowing it', async () => {
    // The old call site wrapped recordAudit in `.catch(() => {})`. A save whose
    // audit event cannot be written must reject, so the swallow cannot return.
    const txFor = (auditError) => ({
      business: { findUnique: vi.fn(async () => ({ tenantId: 'tenant-1' })) },
      integrationProvider: { upsert: vi.fn(async () => ({ id: 'prov-1', code: 'LINE_OA' })) },
      integrationConnection: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async ({ data }) => ({ id: 'conn-1', ...data })),
        update: vi.fn(),
      },
      auditEvent: { create: vi.fn(async () => { throw auditError }) },
    })
    const groupTx = txFor(new Error('audit store unavailable'))
    const userTx = txFor(new Error('audit store unavailable'))

    await expect(saveLineGroup({
      businessId: OWNED,
      name: 'Sales Team',
      groupId: 'Caudited',
    }, { resolve: () => owner(), db: { $transaction: vi.fn(async (work) => work(groupTx)) } }))
      .rejects.toThrow('audit store unavailable')
    expect(groupTx.integrationConnection.create).toHaveBeenCalledTimes(1)
    expect(groupTx.auditEvent.create).toHaveBeenCalledTimes(1)

    await expect(saveLineUser({
      businessId: OWNED,
      displayName: 'Somchai',
      userId: 'Uaudited',
    }, { resolve: () => owner(), db: { $transaction: vi.fn(async (work) => work(userTx)) } }))
      .rejects.toThrow('audit store unavailable')
    expect(userTx.auditEvent.create).toHaveBeenCalledTimes(1)
  })
})
