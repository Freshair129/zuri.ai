import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_WORKER_OBSERVABILITY_AGE_MS,
  readWorkerObservabilitySource,
} from '@/modules/platform-control/application/worker-observability-source'

const roots = []
const now = new Date('2026-10-16T04:00:00.000Z')
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function createExportDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'zuri-worker-export-'))
  roots.push(root)
  return { root, filePath: join(root, 'worker-observability.json') }
}

function projection(overrides = {}) {
  return {
    schemaVersion: 'worker-observability/v1',
    state: 'LIVE',
    freshness: 'SNAPSHOT',
    observedAt: now.toISOString(),
    source: {
      kind: 'LOCAL_DELIVERY_CONTROLLER', proofScope: 'LOCAL_ONLY', controllerLiveness: 'VERIFIED',
      eventChain: 'VERIFIED', supervisorReceipts: 'NOT_CAPTURED', roadmapIntake: 'NOT_CAPTURED', ciReceipts: 'NOT_CAPTURED',
    },
    summary: { activeWorkers: 1, queuedWorkers: 0, activeTasks: 1, mode: 'SOLO' },
    tasks: [],
    assignments: [],
    events: [
      { taskId: null, cycleNo: null, role: null, kind: 'CYCLE_ADMITTED',
        observedAt: '2026-10-16T03:59:00.000Z', status: 'OBSERVED', sequence: 1 },
      { taskId: null, cycleNo: null, role: null, kind: 'WORKER_STARTED',
        observedAt: '2026-10-16T04:00:00.000Z', status: 'OBSERVED', sequence: 2 },
    ],
    campaignIntake: {
      state: 'NOT_CAPTURED', freshness: 'UNKNOWN', status: 'NOT_CAPTURED', code: null,
      observedAt: null, ageMs: null, source: 'LOCAL_ROADMAP_INTAKE', proofScope: 'LOCAL_ONLY',
      authorityGrant: false, dispatchAllowed: false, selectedTaskId: null, candidates: [],
    },
    localTags: [],
    localTagCount: 0,
    localTagsTruncated: false,
    localTagSetFingerprint: null,
    localStatus: { changedFiles: 0, fingerprint: null, headCommit: 'a'.repeat(40), observedAt: now.toISOString() },
    ...overrides,
  }
}

function writeProjection(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value))
}

describe('worker observability file source', () => {
  it('reads only the configured projection file and filters events by since', () => {
    const { root, filePath } = createExportDirectory()
    const privateControllerState = join(root, '.git', 'zuri-delivery-control')
    writeProjection(filePath, projection())

    const result = readWorkerObservabilitySource({
      filePath,
      repoRoot: privateControllerState,
      since: '2026-10-16T04:00:00.000Z',
      now: () => now,
    })

    expect(result.state).toBe('LIVE')
    expect(result.events).toHaveLength(1)
    expect(result.events[0].kind).toBe('WORKER_STARTED')
    expect(readFileSync(filePath, 'utf8')).toContain('worker-observability/v1')
  })

  it('returns UNKNOWN for a missing or invalid projection', () => {
    const { filePath } = createExportDirectory()
    expect(readWorkerObservabilitySource({ filePath, now: () => now })).toMatchObject({
      state: 'UNKNOWN', reason: 'SOURCE_UNAVAILABLE',
    })

    writeFileSync(filePath, '{broken')
    expect(readWorkerObservabilitySource({ filePath, now: () => now })).toMatchObject({
      state: 'UNKNOWN', reason: 'SOURCE_INVALID',
    })

    writeProjection(filePath, projection({ tasks: null }))
    expect(readWorkerObservabilitySource({ filePath, now: () => now })).toMatchObject({
      state: 'UNKNOWN', reason: 'SOURCE_INVALID',
    })
  })

  it('rejects unknown private fields and malformed nested rows before returning the projection', () => {
    const { filePath } = createExportDirectory()
    const invalidSnapshots = [
      projection({ prompt: 'private prompt payload' }),
      projection({ events: [{ ...projection().events[0], credential: 'private credential' }] }),
      projection({ tasks: [null] }),
      projection({ assignments: [null] }),
      projection({ localTags: [null] }),
    ]

    for (const snapshot of invalidSnapshots) {
      writeProjection(filePath, snapshot)
      expect(readWorkerObservabilitySource({ filePath, now: () => now })).toMatchObject({
        state: 'UNKNOWN', reason: 'SOURCE_INVALID',
      })
    }
  })

  it('accepts reader-generated assignment references beyond three digits', () => {
    const { filePath } = createExportDirectory()
    const assignment = {
      taskId: 'TASK-ZAI-119', cycleNo: 11, role: 'worker', stage: 'IMPLEMENTATION', state: 'RUNNING',
      attempt: 1, checkedHeadCommit: 'b'.repeat(40),
      lease: { state: 'ACTIVE', heartbeatAt: now.toISOString(), ageMs: 0, active: true },
      active: true, queued: false,
      localCheck: { state: 'UNKNOWN', scope: 'LOCAL_ONLY', receiptDigest: null },
      contextMemory: { state: 'NOT_CAPTURED', sourceKindCounts: [], digest: null },
      assignmentRef: 'worker-1000',
    }
    writeProjection(filePath, projection({ assignments: [assignment] }))

    const result = readWorkerObservabilitySource({ filePath, now: () => now })

    expect(result.state).toBe('LIVE')
    expect(result.assignments[0].assignmentRef).toBe('worker-1000')
  })

  it('fails closed for future-dated and more-than-15-second-old snapshots', () => {
    const { filePath } = createExportDirectory()
    writeProjection(filePath, projection({ observedAt: new Date(now.getTime() + 1).toISOString() }))
    expect(readWorkerObservabilitySource({ filePath, now: () => now })).toMatchObject({
      state: 'UNKNOWN', reason: 'SOURCE_FUTURE_DATED',
    })

    writeProjection(filePath, projection({
      observedAt: new Date(now.getTime() - MAX_WORKER_OBSERVABILITY_AGE_MS - 1).toISOString(),
    }))
    expect(readWorkerObservabilitySource({ filePath, now: () => now })).toMatchObject({
      state: 'UNKNOWN', reason: 'SOURCE_STALE',
    })
  })
})
