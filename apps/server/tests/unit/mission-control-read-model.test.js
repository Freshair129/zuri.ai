import { describe, expect, it } from 'vitest'
import { buildMissionControlReadModel } from '@/modules/platform-control/mission-control/application/mission-control-read-model'
import { PORL_SCHEMA_VERSION } from '@/modules/platform-control/mission-control/mission-control-contract'

// @req FR-260 — the read model projects the canonical DAG and named blockers.
// @req FR-261 — absent, stale and malformed PORL data stays UNKNOWN/NOT_RUN.
// @req FR-262 — candidate-parallel pairs expose the first unmet merge gate.
// @spec ADR-048 D3, ADR-086 D1/D7, ADR-092 D3
// @tested tests/unit/mission-control-read-model.test.js

const liveObservation = (taskId = 'TASK-ZAI-081') => ({
  schemaVersion: PORL_SCHEMA_VERSION,
  observationId: 'obs-081',
  runRef: 'run-081',
  taskId,
  laneId: 'LANE-LINE-OA-VAULT',
  capabilityKey: null,
  assignment: { ownerRef: 'Claude', workerRef: 'worker-081', threadRef: 'thread-081' },
  revision: {
    branch: 'feat/integration-secret-store-vault',
    worktreeRef: 'worktree-081',
    baseCommit: '1234567890abcdef1234567890abcdef12345678',
    headCommit: 'abcdef1234567890abcdef1234567890abcdef12',
  },
  runState: 'SUCCEEDED',
  freshness: 'LIVE',
  proofScope: 'LOCAL',
  source: {
    kind: 'test-harness',
    ref: 'receipt-081',
    observedAt: '2026-09-19T03:00:00.000Z',
    capturedAt: '2026-09-19T03:00:00.000Z',
  },
  checks: [{
    kind: 'unit',
    state: 'PASSED',
    scope: 'LOCAL',
    startedAt: '2026-09-19T02:59:00.000Z',
    finishedAt: '2026-09-19T03:00:00.000Z',
    evidenceRefs: ['evidence:081'],
  }],
  changedFiles: {
    state: 'KNOWN',
    paths: ['apps/server/src/modules/platform-control/mission-control/application/mission-control-read-model.js'],
    sourceRef: 'manifest-081',
  },
  evidenceRefs: ['evidence:081'],
  blockers: [],
  reason: null,
})

describe('FR-260/FR-261/FR-262 Mission Control read model', () => {
  it('projects the canonical 120-node, 134-edge, 21-wave DAG and fail-closed execution states', () => {
    const model = buildMissionControlReadModel()
    expect(model.authority).toMatchObject({ source: 'ROADMAP.md', nodeCount: 120, edgeCount: 134, waveCount: 21 })
    expect(model.tasks).toHaveLength(120)
    expect(model.waves).toHaveLength(21)
    expect(model.porl.availability).toBe('UNKNOWN')
    expect(model.tasks.every((task) => task.execution.freshness === 'UNKNOWN')).toBe(true)
    expect(model.tasks.every((task) => task.execution.checks[0].state === 'NOT_RUN')).toBe(true)
  })

  it('keeps the real LINE and MSP blocker families visible from the roadmap', () => {
    const model = buildMissionControlReadModel()
    const line = model.blockers.find((blocker) => blocker.id === 'LINE-TEST-CHANNEL')
    const msp = model.blockers.find((blocker) => blocker.id === 'MSP-MEMORY-CHAIN')
    expect(line).toMatchObject({ state: 'BLOCKED', taskIds: ['TASK-ZAI-081'], source: 'ROADMAP.md' })
    expect(line.tasks[0].title).toContain('real LINE test channel')
    expect(msp).toMatchObject({ state: 'BLOCKED', taskIds: ['TASK-ZAI-100', 'TASK-ZAI-101', 'TASK-ZAI-102'], externalDependency: 'MSP' })
    expect(msp.tasks.map((task) => task.dependsOn)).toEqual([
      ['TASK-ZAI-092', 'TASK-ZAI-089'],
      ['TASK-ZAI-100', 'TASK-ZAI-096'],
      ['TASK-ZAI-101'],
    ])
  })

  it('labels same-wave work candidate-parallel and exposes a failed gate for blocked work', () => {
    const model = buildMissionControlReadModel()
    const pair = model.candidateParallelPairs.find((item) => item.taskIds.includes('TASK-ZAI-081') && item.taskIds.includes('TASK-ZAI-100'))
    expect(pair).toBeDefined()
    expect(pair.scheduling).toBe('CANDIDATE_PARALLEL')
    expect(pair.mergeState).toBe('NOT_SAFE')
    expect(pair.firstUnmet).toMatchObject({ id: 'dependency', state: 'FAIL' })
    expect(pair.mergeSafe).toBe(false)
  })

  it('accepts an explicit LIVE observation without promoting unrelated tasks', () => {
    const model = buildMissionControlReadModel({
      porlResult: {
        availability: 'AVAILABLE',
        source: { kind: 'PORL', ref: 'test-source' },
        observations: [liveObservation()],
        quarantined: [],
        reason: null,
      },
    })
    const observed = model.tasks.find((task) => task.id === 'TASK-ZAI-081')
    const absent = model.tasks.find((task) => task.id === 'TASK-ZAI-100')
    expect(model.porl.observationCount).toBe(1)
    expect(observed.execution).toMatchObject({ freshness: 'LIVE', runState: 'SUCCEEDED', proofScope: 'LOCAL' })
    expect(absent.execution).toMatchObject({ freshness: 'UNKNOWN', runState: 'UNKNOWN' })
    expect(model.porl.freshnessCounts.LIVE).toBe(1)
    expect(model.porl.freshnessCounts.UNKNOWN).toBe(119)
  })

  it('quarantines malformed observations at the projection boundary', () => {
    const model = buildMissionControlReadModel({
      porlResult: { availability: 'AVAILABLE', observations: [{ taskId: 'TASK-ZAI-081' }], quarantined: [], reason: null },
    })
    expect(model.porl.observationCount).toBe(0)
    expect(model.porl.quarantinedCount).toBe(1)
    expect(model.tasks.find((task) => task.id === 'TASK-ZAI-081').execution.freshness).toBe('UNKNOWN')
  })
})
