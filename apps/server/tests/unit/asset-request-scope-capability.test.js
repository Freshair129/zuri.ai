// @req FR-133, FR-135, FR-137 — asset lifecycle mutations (dispose, maintenance, verify) require
// asset write authority, not only domain visibility; an unknown capability fails closed.
// @spec SEC-023, SEC-024, ADR-055
// @tested tests/unit/asset-request-scope-capability.test.js
import { describe, expect, it, vi } from 'vitest'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer: vi.fn() }))

const { resolveAssetRequestScope } = await import('@/modules/asset-management/application/asset-request-scope')

const DOMAINS = ['projects', 'people', 'platform', 'assets']
const db = { business: { findUnique: vi.fn(async ({ where }) => ({ id: where.id, tenantId: 't-1' })) } }
const request = new Request('http://localhost/api/assets/register/ast-1/dispose', { method: 'POST' })
const scope = (viewer, capability, businessId = 'b-target') =>
  resolveAssetRequestScope(request, businessId, { db, capability, viewer })

describe("resolveAssetRequestScope capability: 'manage'", () => {
  it('refuses a member who only sees the Business and its Assets domain', async () => {
    const viewer = ownsElsewhere({ owns: 'b-owned', sees: 'b-target', visibleDomains: DOMAINS })
    await expect(scope(viewer, 'manage')).rejects.toMatchObject({ status: 404 })
  })

  it('still lets the same member read', async () => {
    const viewer = ownsElsewhere({ owns: 'b-owned', sees: 'b-target', visibleDomains: DOMAINS })
    await expect(scope(viewer, 'read')).resolves.toMatchObject({ business: { id: 'b-target' } })
  })

  it('allows the Business owner', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-target'], ownedBusinessIds: ['b-target'], visibleDomains: DOMAINS })
    await expect(scope(viewer, 'manage')).resolves.toMatchObject({ business: { id: 'b-target' } })
  })

  it('allows a member holding the asset receiver role on that Business', async () => {
    const viewer = makeViewer({
      visibleBusinessIds: ['b-target'], visibleDomains: DOMAINS,
      rolesByBusinessId: { 'b-target': ['ASSET_RECEIVER'] },
    })
    await expect(scope(viewer, 'manage')).resolves.toMatchObject({ business: { id: 'b-target' } })
  })

  it('fails closed on a capability it does not recognise', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-target'], ownedBusinessIds: ['b-target'], visibleDomains: DOMAINS })
    await expect(scope(viewer, 'delete')).rejects.toMatchObject({ status: 500 })
  })
})
