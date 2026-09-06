import { describe, it, expect } from 'vitest'
import { buildBusinessHomeReadModel, DOMAIN_STATE, SEVERITY } from '@/modules/business/application/business-home-read-model'

// @req FR-060 — Business Home Dashboard projection.
// @spec SDD-033 — non-owning, pure, nothing persisted.
// @tested tests/unit/fr060-business-home-read-model.test.js

const NOW = Date.parse('2026-08-17T00:00:00Z')
const past = '2026-08-01T00:00:00Z'
const future = '2026-09-01T00:00:00Z'

const DOMAINS = [
  { key: 'business-home', label: 'Business Home' },
  { key: 'commerce', label: 'Commerce', soon: true },
  { key: 'customer', label: 'CRM', soon: true },
  { key: 'people', label: 'HR / People' },
  { key: 'projects', label: 'Development' },
  { key: 'platform', label: 'Platform' },
]

const project = (over = {}) => ({
  id: 'p1', code: 'PRJ-1', name: 'One', status: 'ACTIVE',
  gates: [], milestones: [], workstreams: [], ...over,
})

const build = (over = {}) =>
  buildBusinessHomeReadModel({ projects: [], strategy: null, domains: DOMAINS, now: NOW, ...over })

describe('reserved domains', () => {
  it('render as RESERVED with no score — never zero', () => {
    const { health } = build()
    const commerce = health.domains.find((d) => d.key === 'commerce')
    expect(commerce.state).toBe(DOMAIN_STATE.RESERVED)
    expect(commerce.score).toBeNull()
    expect(commerce.signal).toMatch(/no module/i)
  })

  it('never contribute to the composite score', () => {
    const { health } = build({ projects: [project()] })
    expect(health.covers).toEqual(['projects'])
    expect(health.coverageLabel).toBe('1 of 5 domains')
  })

  it('keeps RESERVED distinct from a live domain with nothing to report', () => {
    const { health } = build()
    expect(health.domains.find((d) => d.key === 'platform').state).toBe(DOMAIN_STATE.NO_SIGNAL)
    expect(health.domains.find((d) => d.key === 'commerce').state).toBe(DOMAIN_STATE.RESERVED)
  })

  it('reports one row per registry domain, in registry order', () => {
    const { health } = build()
    expect(health.domains.map((d) => d.key)).toEqual(['commerce', 'customer', 'people', 'projects', 'platform'])
  })

  it('never reports on Business Home itself — the surface is not one of its own rows', () => {
    // The registry fixture includes `business-home`; it must be filtered out, or
    // the slot scores itself and inflates the coverage denominator with a domain
    // that owns nothing.
    const { health } = build()
    expect(health.domains.map((d) => d.key)).not.toContain('business-home')
    expect(health.coverageLabel).toBe('0 of 5 domains')
  })
})

describe('composite score', () => {
  it('is null when no domain can be scored, rather than 0', () => {
    const { health } = build()
    expect(health.score).toBeNull()
    expect(health.covers).toEqual([])
  })

  it('drops for an overdue required gate', () => {
    const clean = build({ projects: [project()] }).health.score
    const late = build({
      projects: [project({ gates: [{ id: 'g1', title: 'Launch', required: true, status: 'OPEN', targetAt: past }] })],
    }).health.score
    expect(clean).toBe(100)
    expect(late).toBeLessThan(clean)
  })

  it('penalises an overdue gate more than an open one that is not yet due', () => {
    const open = build({ projects: [project({ gates: [{ id: 'g1', title: 'G', required: true, status: 'OPEN', targetAt: future }] })] }).health.score
    const late = build({ projects: [project({ gates: [{ id: 'g1', title: 'G', required: true, status: 'OPEN', targetAt: past }] })] }).health.score
    expect(late).toBeLessThan(open)
  })

  it('ignores gates that are not required, and passed ones', () => {
    const score = build({
      projects: [project({
        gates: [
          { id: 'g1', title: 'Optional', required: false, status: 'OPEN', targetAt: past },
          { id: 'g2', title: 'Done', required: true, status: 'PASSED', targetAt: past },
          { id: 'g3', title: 'Waived', required: true, status: 'WAIVED', targetAt: past },
        ],
      })],
    }).health.score
    expect(score).toBe(100)
  })

  it('never goes below zero however bad the inputs are', () => {
    const gates = Array.from({ length: 40 }, (_, i) => ({ id: `g${i}`, title: 'G', required: true, status: 'OPEN', targetAt: past }))
    expect(build({ projects: [project({ gates })] }).health.score).toBe(0)
  })
})

describe('people', () => {
  it('reports a headcount as a signal, never as a health score', () => {
    const row = build({ peopleCount: 42 }).health.domains.find((d) => d.key === 'people')
    expect(row.signal).toBe('42 people in scope')
    expect(row.score).toBeNull()
    expect(row.state).toBe(DOMAIN_STATE.NO_SIGNAL)
  })

  it('says "1 person", not "1 people"', () => {
    expect(build({ peopleCount: 1 }).health.domains.find((d) => d.key === 'people').signal).toBe('1 person in scope')
  })

  it('falls back to no signal when the count is unavailable', () => {
    expect(build().health.domains.find((d) => d.key === 'people').signal).toBe('No health signal yet')
  })
})

describe('attention queue', () => {
  it('is empty when nothing is wrong', () => {
    expect(build({ projects: [project()] }).attention).toEqual([])
  })

  it('raises an overdue required gate as HIGH and an on-time one as MED', () => {
    const { attention } = build({
      projects: [project({
        gates: [
          { id: 'late', title: 'Late', required: true, status: 'OPEN', targetAt: past },
          { id: 'soon', title: 'Soon', required: true, status: 'OPEN', targetAt: future },
        ],
      })],
    })
    expect(attention.find((a) => a.id === 'gate:late').severity).toBe(SEVERITY.HIGH)
    expect(attention.find((a) => a.id === 'gate:soon').severity).toBe(SEVERITY.MED)
  })

  it('raises an overdue milestone but not a completed one', () => {
    const { attention } = build({
      projects: [project({
        milestones: [
          { id: 'm1', title: 'Slipped', status: 'PLANNED', targetAt: past },
          { id: 'm2', title: 'Shipped', status: 'DONE', targetAt: past },
        ],
      })],
    })
    expect(attention.map((a) => a.id)).toEqual(['milestone:m1'])
  })

  it('raises a goal past target, and flags an unlinked goal only as INFO', () => {
    const { attention } = build({
      strategy: {
        goals: [
          { id: 'g-late', code: 'G1', title: 'Late goal', status: 'ACTIVE', targetAt: past, projects: [{ id: 'p1' }] },
          { id: 'g-orphan', code: 'G2', title: 'Orphan goal', status: 'ACTIVE', targetAt: future, projects: [] },
          { id: 'g-done', code: 'G3', title: 'Done goal', status: 'DONE', targetAt: past, projects: [] },
        ],
      },
    })
    expect(attention.find((a) => a.id === 'goal:g-late').severity).toBe(SEVERITY.HIGH)
    expect(attention.find((a) => a.id === 'goal-unlinked:g-orphan').severity).toBe(SEVERITY.INFO)
    expect(attention.some((a) => a.id.includes('g-done'))).toBe(false)
  })

  it('orders by severity and is deterministic regardless of input order', () => {
    const gates = [
      { id: 'b', title: 'B', required: true, status: 'OPEN', targetAt: future },
      { id: 'a', title: 'A', required: true, status: 'OPEN', targetAt: past },
    ]
    const forward = build({ projects: [project({ gates })] }).attention.map((a) => a.id)
    const reversed = build({ projects: [project({ gates: [...gates].reverse() })] }).attention.map((a) => a.id)
    expect(forward[0]).toBe('gate:a')
    expect(forward).toEqual(reversed)
  })

  it('tolerates a missing or unparseable target date instead of treating it as overdue', () => {
    const { attention } = build({
      projects: [project({
        gates: [{ id: 'g1', title: 'No date', required: true, status: 'OPEN' }],
        milestones: [{ id: 'm1', title: 'Junk date', status: 'PLANNED', targetAt: 'not-a-date' }],
      })],
    })
    expect(attention.map((a) => a.id)).toEqual(['gate:g1'])
    expect(attention[0].severity).toBe(SEVERITY.MED)
  })
})

describe('briefing', () => {
  it('states coverage rather than implying the score covers everything', () => {
    const { briefing } = build({ projects: [project()] })
    expect(briefing.line).toContain('1 of 5 domains')
    expect(briefing.line).toMatch(/reserved/i)
  })

  it('says nothing is overdue when the queue is empty', () => {
    expect(build({ projects: [project()] }).briefing.line).toMatch(/nothing is overdue/i)
  })

  it('leads with the count that needs action when there is one', () => {
    const { briefing } = build({
      projects: [project({ gates: [{ id: 'g1', title: 'G', required: true, status: 'OPEN', targetAt: past }] })],
    })
    expect(briefing.line).toMatch(/1 item needs attention now/i)
  })

  it('does not claim a health figure when nothing is measurable', () => {
    expect(build().briefing.line).toMatch(/no domain reports a health signal yet/i)
  })
})

describe('purity', () => {
  it('does not mutate its inputs', () => {
    const projects = [project({ gates: [{ id: 'g1', title: 'G', required: true, status: 'OPEN', targetAt: past }] })]
    const snapshot = JSON.parse(JSON.stringify(projects))
    build({ projects })
    expect(projects).toEqual(snapshot)
  })

  it('is deterministic for the same inputs and the same clock', () => {
    const args = { projects: [project({ gates: [{ id: 'g1', title: 'G', required: true, status: 'OPEN', targetAt: past }] })] }
    expect(JSON.stringify(build(args))).toBe(JSON.stringify(build(args)))
  })
})
