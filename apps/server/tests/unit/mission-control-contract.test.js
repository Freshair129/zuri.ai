import { describe, expect, it } from 'vitest'
import {
  parseProgrammeOrchestrationObservation,
  PORL_SCHEMA_VERSION,
} from '@/modules/platform-control/mission-control/mission-control-contract'
import { createProgrammeOrchestrationRunLedgerAdapter } from '@/modules/platform-control/mission-control/application/programme-orchestration-run-ledger'

// @req FR-261 — PORL observations need source/time provenance, truthful
// freshness states, bounded evidence and fail-closed malformed-record handling.
// @spec ADR-048 D3, ADR-086 D1/D7, SDD-008
// @tested tests/unit/mission-control-contract.test.js

const validObservation = (overrides = {}) => ({
  schemaVersion: PORL_SCHEMA_VERSION,
  observationId: 'obs-001',
  runRef: 'run-001',
  taskId: 'TASK-ZAI-081',
  laneId: 'LANE-LINE-OA-VAULT',
  capabilityKey: null,
  assignment: { ownerRef: 'Claude', workerRef: 'worker-001', threadRef: 'thread-001' },
  revision: {
    branch: 'feat/integration-secret-store-vault',
    worktreeRef: 'worktree-001',
    baseCommit: '1234567890abcdef1234567890abcdef12345678',
    headCommit: 'abcdef1234567890abcdef1234567890abcdef12',
  },
  runState: 'SUCCEEDED',
  freshness: 'LIVE',
  proofScope: 'LOCAL',
  source: {
    kind: 'test-harness',
    ref: 'receipt-001',
    observedAt: '2026-09-19T03:00:00.000Z',
    capturedAt: '2026-09-19T03:00:00.000Z',
  },
  checks: [{
    kind: 'unit',
    state: 'PASSED',
    scope: 'LOCAL',
    startedAt: '2026-09-19T02:59:00.000Z',
    finishedAt: '2026-09-19T03:00:00.000Z',
    evidenceRefs: ['evidence:unit-001'],
  }],
  changedFiles: {
    state: 'KNOWN',
    paths: ['apps/server/src/modules/platform-control/mission-control/application/mission-control-read-model.js'],
    sourceRef: 'manifest-001',
  },
  evidenceRefs: ['evidence:unit-001'],
  blockers: [],
  reason: null,
  ...overrides,
})

describe('FR-261 PORL observation contract', () => {
  it('accepts a provenance-bound LIVE observation with a complete revision tuple', () => {
    const parsed = parseProgrammeOrchestrationObservation(validObservation())
    expect(parsed.ok).toBe(true)
    expect(parsed.value.freshness).toBe('LIVE')
    expect(parsed.value.source.observedAt).toBe('2026-09-19T03:00:00.000Z')
  })

  it('requires observed time for LIVE and captured time for SNAPSHOT', () => {
    const live = parseProgrammeOrchestrationObservation(validObservation({
      source: { ...validObservation().source, observedAt: null },
    }))
    const snapshot = parseProgrammeOrchestrationObservation(validObservation({
      freshness: 'SNAPSHOT',
      source: { ...validObservation().source, observedAt: null, capturedAt: null },
    }))
    expect(live.ok).toBe(false)
    expect(live.issues.some((issue) => issue.path === 'source.observedAt')).toBe(true)
    expect(snapshot.ok).toBe(false)
    expect(snapshot.issues.some((issue) => issue.path === 'source.capturedAt')).toBe(true)
  })

  it('requires an absence reason for UNKNOWN and refuses unscoped changed files', () => {
    const unknown = parseProgrammeOrchestrationObservation(validObservation({
      freshness: 'UNKNOWN',
      runState: 'UNKNOWN',
      reason: null,
      source: { ...validObservation().source, observedAt: null, capturedAt: null },
      changedFiles: { state: 'UNKNOWN', paths: [], sourceRef: null },
    }))
    const files = parseProgrammeOrchestrationObservation(validObservation({
      changedFiles: { state: 'KNOWN', paths: ['secret.txt'], sourceRef: null },
    }))
    expect(unknown.ok).toBe(false)
    expect(unknown.issues.some((issue) => issue.path === 'reason')).toBe(true)
    expect(files.ok).toBe(false)
    expect(files.issues.some((issue) => issue.path === 'changedFiles.sourceRef')).toBe(true)
  })

  it('defaults the adapter to a read-only UNKNOWN result without a source connector', async () => {
    const adapter = createProgrammeOrchestrationRunLedgerAdapter()
    const result = await adapter.listObservations(['TASK-ZAI-081'])
    expect(adapter.readOnly).toBe(true)
    expect(result.availability).toBe('UNKNOWN')
    expect(result.observations).toEqual([])
    expect(result.reason).toBe('PORL_SOURCE_UNAVAILABLE')
  })

  it('quarantines malformed or unmapped injected records instead of projecting them', async () => {
    const adapter = createProgrammeOrchestrationRunLedgerAdapter({
      read: async () => [validObservation(), { ...validObservation(), taskId: 'TASK-ZAI-999' }, { bad: true }],
    })
    const result = await adapter.listObservations(['TASK-ZAI-081'])
    expect(result.observations).toHaveLength(1)
    expect(result.quarantined).toHaveLength(2)
    expect(result.availability).toBe('UNKNOWN')
  })
})
