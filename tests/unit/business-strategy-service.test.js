import { describe, expect, it } from 'vitest'
import { getBusinessStrategy } from '@/modules/business/application/business-strategy-service'

// @req FR-041 - Business Strategy is a two/three-horizon read model.
// @spec SDD-020, ADR-013
// @tested tests/unit/business-strategy-service.test.js

function dbFor(business) {
  return { business: { findUnique: async () => business } }
}

const baseBusiness = {
  id: 'b1', code: 'BUS-001', name: 'Business 01', status: 'ACTIVE', tenantId: 't1',
  roadmaps: [{
    id: 'rm1', code: 'RM-1', title: 'Direction', description: null, status: 'ACTIVE', startAt: null, targetAt: null,
    horizons: [
      { id: 'h1', key: 'SHORT', label: 'Short term', position: 1, description: null, targetAt: null, goals: [{ id: 'g1', code: 'G1', title: 'Foundation', description: null, status: 'ACTIVE', priority: 'HIGH', progress: 40, startAt: null, targetAt: null, projects: [{ project: { id: 'p1', code: 'P1', name: 'Business project', status: 'ACTIVE', workspace: { businessId: 'b1' } } }] }] },
      { id: 'h2', key: 'MEDIUM', label: 'Medium term', position: 2, description: null, targetAt: null, goals: [] },
    ],
  }],
}

describe('getBusinessStrategy', () => {
  it('returns ordered horizons and excludes linked projects from another Business', async () => {
    const data = await getBusinessStrategy('b1', { db: dbFor(baseBusiness), visibleBusinessIds: ['b1'] })
    expect(data.business.code).toBe('BUS-001')
    expect(data.roadmaps[0].horizons.map((horizon) => horizon.key)).toEqual(['SHORT', 'MEDIUM'])
    expect(data.roadmaps[0].horizons[0].goals[0].projects).toHaveLength(1)
    expect(data.summary).toMatchObject({ horizonCount: 2, goalCount: 1, averageProgress: 40 })
  })

  it('fails closed for an invisible Business', async () => {
    await expect(getBusinessStrategy('b1', { db: dbFor(baseBusiness), visibleBusinessIds: ['b2'] })).rejects.toThrow('Business access denied')
  })

  it('rejects a roadmap with fewer than two horizons', async () => {
    const invalid = { ...baseBusiness, roadmaps: [{ ...baseBusiness.roadmaps[0], horizons: [baseBusiness.roadmaps[0].horizons[0]] }] }
    await expect(getBusinessStrategy('b1', { db: dbFor(invalid), visibleBusinessIds: ['b1'] })).rejects.toThrow('2 or 3 horizons')
  })
})
