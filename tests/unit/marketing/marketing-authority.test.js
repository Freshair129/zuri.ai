import { describe, expect, it } from 'vitest'
import { makeViewer, ownsElsewhere } from '../../factories/viewer'
import {
  assertMarketingReadAccess,
  assertMarketingWriteAccess,
} from '@/modules/marketing/application/marketing-authority'

// @req FR-153 — Marketing authority is Business-local, growth-gated and
// owner-only for persistence writes.
// @spec SDD-086, BR-001, SEC-001
// @tested tests/unit/marketing/marketing-authority.test.js

const domains = ['projects', 'people', 'platform', 'growth']

function dbFor(status = 'ACTIVE') {
  return {
    business: {
      findUnique: async () => ({ id: 'b-1', tenantId: 't-1', status }),
    },
  }
}

describe('Marketing authority', () => {
  it('derives tenant scope from an owned active Business', async () => {
    const viewer = makeViewer({
      principal: { id: 'owner' },
      visibleBusinessIds: ['b-1'],
      ownedBusinessIds: ['b-1'],
      visibleDomains: domains,
    })
    await expect(assertMarketingWriteAccess({ db: dbFor(), viewer, businessId: 'b-1' }))
      .resolves.toMatchObject({ scope: { tenantId: 't-1', businessId: 'b-1' }, canWrite: true })
  })

  it('allows a visible growth member to read but not write', async () => {
    const viewer = makeViewer({
      role: 'MEMBER',
      principal: { id: 'member' },
      visibleBusinessIds: ['b-1'],
      ownedBusinessIds: [],
      visibleDomains: ['growth'],
    })
    await expect(assertMarketingReadAccess({ db: dbFor(), viewer, businessId: 'b-1' })).resolves.toBeTruthy()
    await expect(assertMarketingWriteAccess({ db: dbFor(), viewer, businessId: 'b-1' }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
  })

  it('refuses hidden domains, archived Businesses and owner-elsewhere viewers', async () => {
    const hidden = makeViewer({
      role: 'MEMBER',
      principal: { id: 'hidden' },
      visibleBusinessIds: ['b-1'],
      ownedBusinessIds: [],
      visibleDomains: ['projects'],
    })
    await expect(assertMarketingReadAccess({ db: dbFor(), viewer: hidden, businessId: 'b-1' }))
      .rejects.toMatchObject({ status: 404 })

    const ownerElsewhere = ownsElsewhere({ owns: 'b-owned', sees: 'b-1', visibleDomains: domains })
    await expect(assertMarketingWriteAccess({ db: dbFor(), viewer: ownerElsewhere, businessId: 'b-1' }))
      .rejects.toMatchObject({ status: 404 })

    const owner = makeViewer({
      principal: { id: 'owner' },
      visibleBusinessIds: ['b-1'],
      ownedBusinessIds: ['b-1'],
      visibleDomains: domains,
    })
    await expect(assertMarketingWriteAccess({ db: dbFor('ARCHIVED'), viewer: owner, businessId: 'b-1' }))
      .rejects.toMatchObject({ status: 404 })
  })
})

