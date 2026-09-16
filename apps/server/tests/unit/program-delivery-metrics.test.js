// @req FR-216 — phase card figures: planned counts, size, plan window and effort
//   from the sizing table, and measured usage beside them that is null (not
//   measured) rather than zero or the prediction.
// @req FR-218 — reports merge with metered usage, one session counted once.
// @req FR-219 — subtask progress under the board mapping.
// @spec ADR-086 D1, D2, D3, D5, D6
// @tested tests/unit/program-delivery-metrics.test.js
import { describe, expect, it } from 'vitest'
import {
  mergeLaneUsage,
  phaseDeliveryMetrics,
  planWindowDays,
  subtaskProgress,
  tokensUsed,
} from '@/modules/platform-control/program-delivery-metrics'
import { PROGRAMME_PHASES, PROGRAMME_TASKS } from '@/modules/platform-control/program-roadmap-data'

const sizing = { points: { 'C-1': 1, 'C-2': 2, 'C-3': 3 }, effortHours: { 'C-1': 2, 'C-2': 6, 'C-3': 16 }, activeGapCapMinutes: 15 }
const phase = {
  id: 'PHASE-X', start: '2026-09-07', end: '2026-09-20', status: 'done',
  sprints: [{ id: 'SPR-X1' }, { id: 'SPR-X2' }],
}
const tasks = [
  ['TASK-ZAI-901', 'SPR-X1', 't1', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-902', 'SPR-X1', 't2', 'FR', 'C-2', 'H2', 'review'],
  ['TASK-ZAI-903', 'SPR-X2', 't3', 'NFR', 'C-1', 'H1', 'planned'],
  ['TASK-ZAI-999', 'SPR-OTHER', 'other', 'FR', 'C-3', 'H3', 'done'],
]
const containers = { 'TASK-ZAI-901': { predictedTokens: 40000 }, 'TASK-ZAI-902': { predictedTokens: 20000 }, 'TASK-ZAI-903': { predictedTokens: 5000 } }
const lanes = [{ id: 'LANE-X', tasks: ['TASK-ZAI-901', 'TASK-ZAI-902'], branches: ['feat/x'] }]
const usage = {
  meter: 'scripts/programme-usage-meter.mjs',
  measuredThrough: '2026-09-13T12:00:00.000Z',
  lanes: {
    'LANE-X': {
      requests: 100,
      sessions: ['claude-code:s1'],
      tokens: { input: 1000, cacheWrite: 50000, cacheRead: 9000000, output: 20000 },
      bySource: { 'claude-code': { requests: 100 } },
      firstActivityAt: '2026-09-13T08:00:00.000Z',
      lastActivityAt: '2026-09-13T12:00:00.000Z',
      activeMinutes: 95,
    },
  },
}
const report = (over = {}) => ({
  source: 'codex', sessionId: 'thread-9', taskCode: 'TASK-ZAI-903', model: null,
  inputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 4000, outputTokens: 60, requestCount: 12, activeMinutes: 20,
  startedAt: '2026-09-14T01:00:00.000Z', endedAt: '2026-09-14T01:30:00.000Z', ...over,
})

describe('FR-216 planned figures', () => {
  it('counts sprints, tasks per status, size points, plan days, effort hours and predicted tokens for the phase only', () => {
    const m = phaseDeliveryMetrics({ phase, tasks, containers, sizing, lanes, laneUsage: new Map() })
    expect(m).toMatchObject({ sprintCount: 2, taskCount: 3, byStatus: { done: 1, review: 1, planned: 1 }, sizePoints: 6, effortHours: 24, planDays: 14, predictedTokens: 65000, done: true, measured: null })
  })

  it('reads the plan window of every real phase from its own dates', () => {
    expect(planWindowDays('2026-08-24', '2026-09-20')).toBe(28)
    expect(planWindowDays('2026-12-14', '2027-01-10')).toBe(28)
    expect(planWindowDays('2026-09-20', '2026-09-01')).toBeNull()
    for (const p of PROGRAMME_PHASES) {
      expect(planWindowDays(p.start, p.end)).toBe(28)
      for (const s of p.sprints) expect(planWindowDays(s.start, s.end)).toBe(14)
    }
  })
})

describe('FR-216 / FR-218 measured figures', () => {
  it('shows a lane once for the phase, with elapsed and active time and its sources', () => {
    const laneUsage = mergeLaneUsage({ lanes, usage, reports: [] })
    const { measured } = phaseDeliveryMetrics({ phase, tasks, containers, sizing, lanes, laneUsage })
    expect(measured.used).toBe(71000)
    expect(measured.tokens.cacheRead).toBe(9000000)
    expect(measured.elapsedDays).toBeCloseTo(4 / 24)
    expect(measured).toMatchObject({ activeMinutes: 95, sessions: 1, lanes: 1, coveredTasks: 2, sources: ['claude-code'] })
  })

  it('adds a report for a task in no lane as its own lane, and skips a report the meter already counted', () => {
    const laneUsage = mergeLaneUsage({ lanes, usage, reports: [report(), report({ source: 'claude-code', sessionId: 's1', taskCode: 'TASK-ZAI-901' })] })
    expect(laneUsage.get('LANE-X').sessions).toBe(1)
    expect(laneUsage.get('LANE-X').tokens.output).toBe(20000)
    expect(laneUsage.get('TASK:TASK-ZAI-903')).toMatchObject({ sessions: 1, reported: 1, activeMinutes: 20, sources: ['report:codex'] })
    const { measured } = phaseDeliveryMetrics({ phase, tasks, containers, sizing, lanes, laneUsage })
    expect(measured.used).toBe(71000 + 360)
    expect(measured.coveredTasks).toBe(3)
    expect(measured.sources).toEqual(['claude-code', 'report:codex'])
    expect(measured.lastActivityAt).toBe('2026-09-14T01:30:00.000Z')
  })

  it('counts a session reported twice once', () => {
    const laneUsage = mergeLaneUsage({ lanes: [], usage: { lanes: {} }, reports: [report(), report()] })
    expect(laneUsage.get('TASK:TASK-ZAI-903').sessions).toBe(1)
  })

  it('never turns the prediction into a measurement', () => {
    const { measured, predictedTokens } = phaseDeliveryMetrics({ phase, tasks, containers, sizing, lanes, laneUsage: mergeLaneUsage({ lanes, usage: { lanes: {} }, reports: [] }) })
    expect(measured).toBeNull()
    expect(predictedTokens).toBe(65000)
    expect(tokensUsed({ input: 1, cacheWrite: 2, cacheRead: 1000, output: 3 })).toBe(6)
  })

  it('computes the real programme without throwing for every phase', () => {
    for (const p of PROGRAMME_PHASES) {
      const m = phaseDeliveryMetrics({ phase: p, tasks: PROGRAMME_TASKS, containers: {}, sizing, lanes: [], laneUsage: new Map() })
      expect(m.taskCount).toBe(PROGRAMME_TASKS.filter((t) => p.sprints.some((s) => s.id === t[1])).length)
    }
  })
})

describe('FR-219 subtask progress', () => {
  it('uses the board mapping and gives no bar without subtasks', () => {
    expect(subtaskProgress([])).toBeNull()
    expect(subtaskProgress([{ status: 'done' }, { status: 'review' }, { status: 'planned' }])).toBe(63)
    expect(subtaskProgress([{ status: 'in-progress' }, { status: 'done' }])).toBe(75)
  })
})
