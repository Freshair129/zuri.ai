// @req FR-059 - Business Strategy mutation Zod boundary + horizon cardinality rule.
// @spec SDD-032, BR-009
// @tested tests/unit/fr059-strategy-validation.test.js
import { describe, expect, it } from 'vitest'
import {
  zRoadmapCreateInput,
  zRoadmapPatchInput,
  zGoalCreateInput,
  zGoalPatchInput,
  zProjectLinkInput,
  assertHorizonCardinality,
} from '@/modules/project-manager/application/business-strategy-mutation-service'

const horizons = [
  { key: 'SHORT', label: 'Short term', position: 1 },
  { key: 'MEDIUM', label: 'Medium term', position: 2 },
]

describe('FR-059 Zod boundary', () => {
  describe('zRoadmapCreateInput', () => {
    it('accepts a minimal valid payload and defaults status to ACTIVE', () => {
      const data = zRoadmapCreateInput.parse({ businessId: 'b1', title: 'Direction', horizons })
      expect(data.status).toBe('ACTIVE')
      expect(data.horizons).toHaveLength(2)
    })

    it('rejects a status outside ROADMAP_STATUSES', () => {
      expect(() =>
        zRoadmapCreateInput.parse({ businessId: 'b1', title: 'Direction', status: 'DRAFT', horizons })
      ).toThrow()
    })

    it('rejects a missing businessId or title', () => {
      expect(() => zRoadmapCreateInput.parse({ title: 'Direction', horizons })).toThrow()
      expect(() => zRoadmapCreateInput.parse({ businessId: 'b1', horizons })).toThrow()
    })

    it('rejects a horizon missing key/label/position', () => {
      expect(() =>
        zRoadmapCreateInput.parse({ businessId: 'b1', title: 'Direction', horizons: [{ label: 'Short term', position: 1 }] })
      ).toThrow()
    })

    it('coerces startAt/targetAt into Date instances', () => {
      const data = zRoadmapCreateInput.parse({
        businessId: 'b1', title: 'Direction', horizons, startAt: '2026-01-01', targetAt: '2026-12-31',
      })
      expect(data.startAt).toBeInstanceOf(Date)
      expect(data.targetAt).toBeInstanceOf(Date)
    })

    it('does not itself enforce 2-3 horizons — that is the service-level cardinality rule', () => {
      const data = zRoadmapCreateInput.parse({ businessId: 'b1', title: 'Direction', horizons: [horizons[0]] })
      expect(data.horizons).toHaveLength(1)
    })

    // A negative position passed every other current validation (cardinality
    // 2-3, unique keys, unique positions) but broke reconcileHorizons's
    // negative-sentinel staging, which assumed real positions are
    // non-negative: existing SHORT(1)/MEDIUM(2), patch SHORT->-2/MEDIUM->-1
    // stages SHORT->-1/MEDIUM->-2, then the final write for SHORT (-2)
    // collides with MEDIUM's still-staged sentinel (-2), tripping
    // @@unique([roadmapId, position]) as a raw P2002 -> 500. Bounding
    // position to non-negative at the schema rejects this at parse time
    // (400), before any write is attempted.
    it('rejects a negative horizon position at the schema, not at the database', () => {
      expect(() =>
        zRoadmapCreateInput.parse({
          businessId: 'b1',
          title: 'Direction',
          horizons: [{ ...horizons[0], position: -1 }, horizons[1]],
        })
      ).toThrow()
    })
  })

  describe('zRoadmapPatchInput', () => {
    it('accepts an empty patch (every field optional)', () => {
      expect(zRoadmapPatchInput.parse({})).toEqual({})
    })

    it('rejects an invalid status on patch', () => {
      expect(() => zRoadmapPatchInput.parse({ status: 'DRAFT' })).toThrow()
    })

    it('rejects a negative horizon position on patch too (same sentinel-collision risk as create)', () => {
      expect(() =>
        zRoadmapPatchInput.parse({
          horizons: [{ ...horizons[0], position: -2 }, { ...horizons[1], position: -1 }],
        })
      ).toThrow()
    })
  })

  describe('zGoalCreateInput', () => {
    it('defaults status/priority/progress', () => {
      const data = zGoalCreateInput.parse({ businessId: 'b1', title: 'Grow', horizonId: 'h1' })
      expect(data.status).toBe('PLANNED')
      expect(data.priority).toBe('MEDIUM')
      expect(data.progress).toBe(0)
    })

    it('rejects a priority outside GOAL_PRIORITIES', () => {
      expect(() => zGoalCreateInput.parse({ businessId: 'b1', title: 'Grow', horizonId: 'h1', priority: 'LOW' })).toThrow()
    })

    it('rejects a status outside GOAL_STATUSES', () => {
      expect(() => zGoalCreateInput.parse({ businessId: 'b1', title: 'Grow', horizonId: 'h1', status: 'PAUSED' })).toThrow()
    })

    it('rejects progress outside 0-100', () => {
      expect(() => zGoalCreateInput.parse({ businessId: 'b1', title: 'Grow', horizonId: 'h1', progress: 101 })).toThrow()
      expect(() => zGoalCreateInput.parse({ businessId: 'b1', title: 'Grow', horizonId: 'h1', progress: -1 })).toThrow()
    })

    // SHOULD-FIX 5: the FR-041 read model (getBusinessStrategy) nests goals
    // only under roadmap.horizons.goals, so a goal created without a horizon
    // returns 200 and then is invisible on the very next GET. horizonId is
    // therefore required on create; roadmapId stays independently optional
    // (it is derivable from the horizon — see business-strategy-mutation-service.js).
    it('requires horizonId — a goal with none would be invisible on the next GET', () => {
      expect(() => zGoalCreateInput.parse({ businessId: 'b1', title: 'Grow' })).toThrow()
      expect(() => zGoalCreateInput.parse({ businessId: 'b1', title: 'Grow', roadmapId: 'r1' })).toThrow()
    })

    it('accepts roadmapId as independently optional once horizonId is present', () => {
      const data = zGoalCreateInput.parse({ businessId: 'b1', title: 'Grow', horizonId: 'h1' })
      expect(data.horizonId).toBe('h1')
      expect(data.roadmapId).toBeUndefined()
    })
  })

  describe('zGoalPatchInput', () => {
    it('accepts an empty patch and a partial subset', () => {
      expect(zGoalPatchInput.parse({})).toEqual({})
      expect(zGoalPatchInput.parse({ progress: 50 })).toEqual({ progress: 50 })
    })

    it('rejects an explicit null for horizonId/roadmapId — a patch may move a goal, never detach it (SHOULD-FIX 5, extended to update)', () => {
      expect(() => zGoalPatchInput.parse({ horizonId: null })).toThrow()
      expect(() => zGoalPatchInput.parse({ roadmapId: null })).toThrow()
    })
  })

  describe('zProjectLinkInput', () => {
    it('requires projectId', () => {
      expect(() => zProjectLinkInput.parse({})).toThrow()
      expect(zProjectLinkInput.parse({ projectId: 'p1' })).toEqual({ projectId: 'p1' })
    })
  })

  describe('assertHorizonCardinality', () => {
    it('accepts 2 or 3 horizons', () => {
      expect(() => assertHorizonCardinality(horizons)).not.toThrow()
      expect(() => assertHorizonCardinality([...horizons, { key: 'LONG', label: 'Long term', position: 3 }])).not.toThrow()
    })

    it('rejects fewer than 2 with the exact read-side wording', () => {
      expect(() => assertHorizonCardinality([horizons[0]])).toThrow('Business roadmap must have 2 or 3 horizons')
    })

    it('rejects more than 3 with the exact read-side wording', () => {
      const four = [...horizons, { key: 'LONG', label: 'L', position: 3 }, { key: 'X', label: 'X', position: 4 }]
      expect(() => assertHorizonCardinality(four)).toThrow('Business roadmap must have 2 or 3 horizons')
    })

    it('rejects a non-array', () => {
      expect(() => assertHorizonCardinality(undefined)).toThrow('Business roadmap must have 2 or 3 horizons')
    })
  })
})
