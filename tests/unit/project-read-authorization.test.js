// @req FR-046 — protected Project Manager reads resolve one trusted viewer and fail closed.
// @spec SEC-001, SEC-008, ADR-017
// @tested tests/unit/project-read-authorization.test.js
import { describe, expect, it } from 'vitest'
import { makeOperatorViewer, makeViewer, ownsElsewhere } from '../factories/viewer.js'
import {
  assertBusinessReadable,
  assertProjectReadable,
  requireInstallationOperator,
} from '@/modules/identity/read-authorization'

const targetProject = {
  id: 'project-target',
  deletedAt: null,
  businessId: 'b-target',
  business: { tenantId: 'tenant-target' },
  workspace: {
    scopeType: 'BUSINESS',
    businessId: 'b-target',
    tenantId: 'tenant-target',
    portfolioId: 'portfolio-target',
  },
}

describe('Project Manager read authorization seam', () => {
  it('requires an authenticated viewer for business reads', () => {
    expect(() => assertBusinessReadable(undefined, 'b-target')).toThrowError(/AUTH_REQUIRED/)
  })

  it('denies a viewer whose visible scope excludes the target Business', () => {
    expect(() => assertBusinessReadable(ownsElsewhere({ owns: 'b-owned', sees: 'b-other' }), 'b-target'))
      .toThrowError(/not found/i)
  })

  it('denies a cross-scope Project before its read service runs', async () => {
    await expect(assertProjectReadable(ownsElsewhere({ owns: 'b-owned', sees: 'b-other' }), targetProject))
      .rejects.toMatchObject({ status: 404 })
  })

  it('allows a visible Business Project without requiring ownership', async () => {
    await expect(assertProjectReadable(makeViewer({ visibleBusinessIds: ['b-target'], ownedBusinessIds: [] }), targetProject))
      .resolves.toMatchObject({ readScope: 'BUSINESS' })
  })

  it('requires installation operator authority for whole-installation reads', () => {
    expect(() => requireInstallationOperator(makeViewer(), 'snapshot export')).toThrowError(/operator authority/i)
    expect(() => requireInstallationOperator(makeOperatorViewer(), 'snapshot export')).not.toThrow()
  })
})
