// @req FR-218, FR-221, FR-239 — task-bound usage is aggregated from explicit
// report bindings, with plan values, lane evidence and actuals kept separate.
// @spec ADR-086 D1-D7; ADR-087 D4-D6; SDD-008
// @tested tests/unit/task-usage-ledger.test.js

import { describe, expect, it } from 'vitest'
import {
  TaskUsageLedgerSchema,
  buildTaskUsageLedger,
  projectTaskUsageLedger,
  redactTaskUsageLedger,
} from '@/modules/platform-control/application/task-usage-ledger'

const tasks = [
  ['TASK-ZAI-002', 'SPR-ZAI-01', 'Done without a report', 'NFR', 'C-1', 'H1', 'done'],
  ['TASK-ZAI-066', 'SPR-ZAI-02', 'Measured task', 'FR', 'C-3', 'H3', 'done'],
  ['TASK-ZAI-067', 'SPR-ZAI-02', 'Shared lane task', 'FR', 'C-2', 'H2', 'review'],
]

const lanes = [{
  id: 'LANE-DELIVERY-TELEMETRY',
  tasks: ['TASK-ZAI-066', 'TASK-ZAI-067'],
  branches: ['feat/delivery-telemetry'],
}]

const report = (overrides = {}) => ({
  id: 'report-066',
  source: 'codex',
  sessionId: 'session-066',
  branch: 'feat/delivery-telemetry',
  taskCode: 'TASK-ZAI-066',
  model: 'gpt-5.5-codex',
  inputTokens: 1200,
  cacheWriteTokens: 100,
  cacheReadTokens: 9000,
  outputTokens: 800,
  requestCount: 14,
  activeMinutes: 32,
  startedAt: '2026-09-13T10:00:00+00:00',
  endedAt: '2026-09-13T10:40:00+00:00',
  reportedAt: '2026-09-13T10:41:00+00:00',
  payloadSha256: 'a'.repeat(64),
  ...overrides,
})

const input = (overrides = {}) => ({
  knownTasks: tasks,
  containers: {
    'TASK-ZAI-002': { predictedTokens: 16000, totalTokens: 16000 },
    'TASK-ZAI-066': { predictedTokens: 52000, totalTokens: 52000 },
    'TASK-ZAI-067': { predictedTokens: 34000, totalTokens: 34000 },
  },
  lanes,
  meterUsage: { lanes: {} },
  reports: [],
  asOf: '2026-09-14T13:43:56.014Z',
  ...overrides,
})

describe('TaskUsageLedger pure read projection', () => {
  it('keeps a done task prediction in plan and reports no actual without a direct row', () => {
    const ledger = projectTaskUsageLedger(input())
    const row = ledger.tasks.find((task) => task.taskCode === 'TASK-ZAI-002')

    expect(row).toMatchObject({
      taskStatus: 'done',
      plan: { predictedTokens: 16000, source: 'PROGRAMME_CONTAINERS' },
      measurementStatus: 'NOT_REPORTED',
      actual: null,
    })
    expect(row).not.toHaveProperty('totalTokens')
    expect(TaskUsageLedgerSchema.safeParse(ledger).success).toBe(true)
  })

  it('aggregates only the explicit task report and excludes cache reads from used tokens', () => {
    const ledger = projectTaskUsageLedger(input({ reports: [report()] }))
    const row = ledger.tasks.find((task) => task.taskCode === 'TASK-ZAI-066')

    expect(row).toMatchObject({
      measurementStatus: 'MEASURED_DIRECT',
      reconciliationStatus: 'NONE',
      attribution: { kind: 'DIRECT_TASK_CODE', directReportCount: 1, laneIds: ['LANE-DELIVERY-TELEMETRY'] },
      actual: {
        tokens: {
          inputTokens: 1200,
          cacheWriteTokens: 100,
          cacheReadTokens: 9000,
          outputTokens: 800,
          usedTokens: 2100,
        },
        requestCount: 14,
        activeMinutes: 32,
        startedAt: '2026-09-13T10:00:00.000Z',
        endedAt: '2026-09-13T10:40:00.000Z',
        reportCount: 1,
        models: [{ name: 'gpt-5.5-codex', requests: 14 }],
      },
    })
  })

  it('accepts the listProgrammeUsageReports result shape and validates the nested actual contract', () => {
    const ledger = projectTaskUsageLedger(input({ reports: { available: true, reports: [report()] } }))
    const row = ledger.tasks.find((task) => task.taskCode === 'TASK-ZAI-066')

    expect(row.measurementStatus).toBe('MEASURED_DIRECT')
    expect(row.actual).toMatchObject({ tokens: { inputTokens: 1200, usedTokens: 2100 } })
    expect(TaskUsageLedgerSchema.safeParse(ledger).success).toBe(true)
  })

  it('deduplicates the same report key and aggregates separate sessions only for their task', () => {
    const second = report({
      id: 'report-066-second',
      sessionId: 'session-066-second',
      inputTokens: 300,
      cacheWriteTokens: 40,
      cacheReadTokens: 400,
      outputTokens: 60,
      requestCount: 2,
      activeMinutes: 4,
      startedAt: '2026-09-13T12:00:00+00:00',
      endedAt: '2026-09-13T12:05:00+00:00',
      reportedAt: '2026-09-13T12:06:00+00:00',
      payloadSha256: 'b'.repeat(64),
    })
    const ledger = projectTaskUsageLedger(input({ reports: [report(), { ...report(), reportedAt: '2026-09-13T10:42:00+00:00' }, second] }))
    const row = ledger.tasks.find((task) => task.taskCode === 'TASK-ZAI-066')

    expect(row.actual).toMatchObject({
      reportCount: 2,
      requestCount: 16,
      activeMinutes: 36,
      tokens: {
        inputTokens: 1500,
        cacheWriteTokens: 140,
        cacheReadTokens: 9400,
        outputTokens: 860,
        usedTokens: 2500,
      },
    })
  })

  it('keeps shared branch and lane measurements unallocated, including a one-task lane', () => {
    const oneTaskLane = [{ id: 'LANE-ONE', tasks: ['TASK-ZAI-002'], branches: ['feat/one'] }]
    const ledger = projectTaskUsageLedger(input({
      lanes: oneTaskLane,
      meterUsage: { lanes: { 'LANE-ONE': { requests: 3, sessions: ['codex:meter-session'], tokens: { input: 999, output: 888 } } } },
      reports: [report({ taskCode: null, branch: 'feat/one', sessionId: 'branch-only', id: 'report-branch-only', payloadSha256: 'c'.repeat(64) })],
    }))
    const row = ledger.tasks.find((task) => task.taskCode === 'TASK-ZAI-002')

    expect(row).toMatchObject({
      measurementStatus: 'LANE_ONLY_UNALLOCATED',
      reconciliationStatus: 'BRANCH_ONLY_LANE',
      actual: null,
      attribution: { kind: 'LANE_ONLY', directReportCount: 0, laneIds: ['LANE-ONE'] },
    })
    expect(row.warnings).toContain('LANE_ONLY_UNALLOCATED')
  })

  it('marks a direct report that overlaps the meter session as partial without copying lane tokens', () => {
    const ledger = projectTaskUsageLedger(input({
      meterUsage: { lanes: { 'LANE-DELIVERY-TELEMETRY': {
        requests: 900,
        sessions: ['codex:session-066'],
        tokens: { input: 900000, cacheWrite: 0, cacheRead: 0, output: 900000 },
      } } },
      reports: [report()],
    }))
    const row = ledger.tasks.find((task) => task.taskCode === 'TASK-ZAI-066')

    expect(row.measurementStatus).toBe('MEASURED_DIRECT_WITH_WARNING')
    expect(row.reconciliationStatus).toBe('METER_OVERLAP')
    expect(row.actual.tokens.usedTokens).toBe(2100)
    expect(row.actual.requestCount).toBe(14)
    expect(row.warnings).toContain('METER_OVERLAP')
  })

  it('quarantines task rebinding on one report key as a conflict', () => {
    const ledger = projectTaskUsageLedger(input({ reports: [
      report({ taskCode: null }),
      report({ taskCode: 'TASK-ZAI-066', reportedAt: '2026-09-13T10:42:00+00:00' }),
    ] }))
    const row = ledger.tasks.find((task) => task.taskCode === 'TASK-ZAI-066')

    expect(row).toMatchObject({ measurementStatus: 'CONFLICT', reconciliationStatus: 'TASK_BINDING_CHANGED', actual: null })
    expect(row.warnings).toEqual(['REPORT_CONFLICT', 'TASK_BINDING_CHANGED'])
  })

  it('marks an undeclared branch report as unattributed without creating task actuals', () => {
    const ledger = projectTaskUsageLedger(input({ reports: [report({
      taskCode: null,
      branch: 'feat/undeclared',
      id: 'report-unattributed',
    })] }))

    expect(ledger.tasks.every((task) => task.actual === null)).toBe(true)
    expect(ledger.tasks.find((task) => task.taskCode === 'TASK-ZAI-002')).toMatchObject({
      measurementStatus: 'UNATTRIBUTED',
      reconciliationStatus: 'UNATTRIBUTED_REPORT',
      attribution: { kind: 'UNATTRIBUTED', laneIds: [] },
    })
  })

  it('reports source unavailability explicitly and never substitutes zero or plan tokens', () => {
    const ledger = projectTaskUsageLedger(input({ reports: { available: false, reports: [] } }))

    expect(ledger.availability).toBe('SOURCE_UNAVAILABLE')
    expect(ledger.tasks.every((task) => task.measurementStatus === 'SOURCE_UNAVAILABLE')).toBe(true)
    expect(ledger.tasks.every((task) => task.actual === null)).toBe(true)
  })

  it('returns byte-stable JSON when task, lane and report order changes', () => {
    const rows = [report(), report({ id: 'report-066-second', sessionId: 'session-066-second', payloadSha256: 'b'.repeat(64), inputTokens: 10, outputTokens: 5, requestCount: 1, activeMinutes: 1 })]
    const first = projectTaskUsageLedger(input({ tasks: tasks.slice().reverse(), lanes: lanes.slice().reverse(), reports: rows }))
    const second = projectTaskUsageLedger(input({ tasks: tasks.slice().reverse(), lanes: lanes.slice().reverse(), reports: rows.slice().reverse() }))

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(buildTaskUsageLedger(input({ reports: rows }))).toEqual(first)
  })

  it('redacts operator evidence and model names before a public read', () => {
    const ledger = projectTaskUsageLedger(input({ reports: [report()] }))
    const publicLedger = redactTaskUsageLedger(ledger)
    const serialised = JSON.stringify(publicLedger)

    expect(publicLedger.tasks.find((task) => task.taskCode === 'TASK-ZAI-066').actual.models).toEqual([])
    expect(serialised).not.toContain('report-066')
    expect(serialised).not.toContain('gpt-5.5-codex')
    expect(serialised).not.toContain('payloadSha256')
    expect(redactTaskUsageLedger(ledger, 'operator')).toEqual(ledger)
  })
})
