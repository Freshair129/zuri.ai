import { describe, expect, it, vi } from 'vitest'
import { buildViewerEntry } from '@/modules/identity/entry-read-model'
import { ENTRY_BUSINESS_ROW, OWNER_ENTRY_RESPONSE, OWNER_VIEWER } from '../fixtures/fr046-entry-contract'

// @req FR-046 — entry DTO contains only authorized Businesses and required ancestry.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-entry-read-model.test.js

function fakeDb(rows = [ENTRY_BUSINESS_ROW]) {
  return { business: { findMany: vi.fn(async () => rows) } }
}

describe('FR-046 viewer-scoped entry read model', () => {
  it('queries from allowed Business IDs and returns the minimal strict DTO', async () => {
    const db = fakeDb()
    const result = await buildViewerEntry({ viewer: OWNER_VIEWER, db })

    expect(db.business.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['business-1'] } },
    }))
    expect(result).toEqual(OWNER_ENTRY_RESPONSE)
    expect(JSON.stringify(result)).not.toContain('visibleBusinessIds')
    expect(JSON.stringify(result)).not.toContain('memberships')
  })

  it('returns an empty list without querying scope when the viewer has no Business grant', async () => {
    const db = fakeDb()
    const result = await buildViewerEntry({ viewer: { ...OWNER_VIEWER, visibleBusinessIds: [] }, db })

    expect(result.businesses).toEqual([])
    expect(db.business.findMany).not.toHaveBeenCalled()
  })

  it('rejects a repository row outside the authorized Business IDs', async () => {
    const db = fakeDb([{ ...ENTRY_BUSINESS_ROW, id: 'hidden-business' }])
    await expect(buildViewerEntry({ viewer: OWNER_VIEWER, db })).rejects.toThrow('ENTRY_SCOPE_VIOLATION')
  })
})
