import { describe, expect, it } from 'vitest'
import { getBusinessStrategy } from '@/modules/business/application/business-strategy-service'
import { weekStartFor } from '@/modules/project-manager/progress/week'

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

  it('projects active WIGs, deterministic weekly lead-measure values, direct members, commitments and session state additively', async () => {
    const now = new Date('2026-10-12T04:00:00.000Z')
    const currentWeek = weekStartFor(now)
    const previousWeek = new Date(currentWeek.getTime() - 7 * 24 * 60 * 60 * 1000)
    const nextWeek = new Date(currentWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
    const olderWeek = new Date(currentWeek.getTime() - 14 * 24 * 60 * 60 * 1000)
    const business = structuredClone(baseBusiness)
    const goal = business.roadmaps[0].horizons[0].goals[0]
    goal.isWig = true
    goal.keyResults = [{
      id: 'kr-1', code: 'KR-1', title: 'Renewals', metric: 'renewals', unit: 'accounts',
      baseline: 0, target: 10, direction: 'UP', dueAt: new Date('2026-12-01T00:00:00.000Z'),
      ownerPersonId: null, confidence: 3, status: 'ACTIVE', isLagMeasure: true, checkIns: [],
    }]
    business.businessKpis = []
    business.businessLeadMeasures = [{
      id: 'lm-1', goalId: goal.id, name: 'Buyer calls', unit: 'calls', weeklyTarget: 5,
      direction: 'UP', status: 'ACTIVE', values: [
        { id: 'v-old', weekStartAt: previousWeek, value: 2, createdAt: new Date('2026-10-05T00:00:00Z') },
        { id: 'v-newer', weekStartAt: currentWeek, value: 7, createdAt: new Date('2026-10-12T01:00:00Z') },
        { id: 'v-latest', weekStartAt: currentWeek, value: 9, createdAt: new Date('2026-10-12T02:00:00Z') },
      ],
    }]
    business.businessWeeklyCommitments = [{
      id: 'commit-1', weekStartAt: currentWeek, ownerPersonId: 'person-1',
      owner: { id: 'person-1', code: 'PER-1', displayName: 'A Person' },
      leadMeasure: { id: 'lm-1', name: 'Buyer calls', goalId: goal.id }, title: 'Call buyers', done: false,
    }, {
      id: 'commit-2', weekStartAt: nextWeek, ownerPersonId: 'person-1',
      owner: { id: 'person-1', code: 'PER-1', displayName: 'A Person' },
      leadMeasure: null, title: 'Next week', done: true,
    }]
    business.businessWigSessions = [{
      id: 'session-current', businessId: business.id, weekStartAt: currentWeek,
      reportCompletedAt: new Date('2026-10-12T00:00:00Z'), scoreboardCompletedAt: null,
      planCompletedAt: null,
    }, {
      id: 'session-overdue', businessId: business.id, weekStartAt: olderWeek,
      reportCompletedAt: null, scoreboardCompletedAt: new Date('2026-10-01T00:00:00Z'),
      planCompletedAt: null,
    }]
    business.memberships = [{ person: { id: 'person-1', code: 'PER-1', displayName: 'A Person' } }]

    const data = await getBusinessStrategy('b1', { db: dbFor(business), visibleBusinessIds: ['b1'], now })
    expect(data.wigExecution.wigs).toEqual([expect.objectContaining({
      goalId: 'g1', lagKeyResult: expect.objectContaining({ id: 'kr-1', isLagMeasure: true }),
      leadMeasures: [expect.objectContaining({ weeklyBars: expect.arrayContaining([
        expect.objectContaining({ weekStartAt: currentWeek, value: 9, observationId: 'v-latest' }),
      ]) })],
    })])
    expect(data.wigExecution.commitmentPeople).toEqual([{ id: 'person-1', code: 'PER-1', displayName: 'A Person' }])
    expect(data.wigExecution.commitments.current).toEqual([expect.objectContaining({ id: 'commit-1', done: false })])
    expect(data.wigExecution.commitments.next).toEqual([expect.objectContaining({ id: 'commit-2', done: true })])
    expect(data.wigExecution.currentSession).toMatchObject({ id: 'session-current', complete: false })
    expect(data.wigExecution.overdueSessions).toEqual([expect.objectContaining({
      businessId: 'b1', weekStartAt: olderWeek, missingSteps: ['report', 'plan'],
    })])
  })
})
