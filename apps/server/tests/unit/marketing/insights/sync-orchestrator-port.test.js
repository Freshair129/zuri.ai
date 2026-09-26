import { describe, expect, it } from 'vitest'
import {
  assertSyncOrchestratorPort, unavailableSyncOrchestratorPort, zSyncRunStatus, SYNC_ORCHESTRATOR_METHODS,
} from '@/modules/marketing/insights/ports/sync-orchestrator-port'
import { createFakeSyncOrchestrator } from '../../../fixtures/marketing-insights/fixture-sync-orchestrator'

describe('sync orchestrator port', () => {
  it('checks an injected adapter at composition time', () => {
    expect(() => assertSyncOrchestratorPort({})).toThrow(/nextScheduledTick/)
    for (const method of SYNC_ORCHESTRATOR_METHODS) {
      expect(() => assertSyncOrchestratorPort({ [method]: () => {} })).toThrow()
    }
    expect(assertSyncOrchestratorPort(createFakeSyncOrchestrator())).toBeTruthy()
  })

  it('refuses honestly with no orchestration owner assigned', async () => {
    const port = unavailableSyncOrchestratorPort()
    expect(port).toMatchObject({ capability: 'SyncOrchestratorPort', available: false, reasonCode: 'WORKFLOW_ENGINE_OWNER_UNASSIGNED' })
    await expect(port.nextScheduledTick()).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 503 })
    await expect(port.submitManualRefresh({})).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 503 })
    await expect(port.readSyncStatus({})).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 503 })
  })

  it('accepts a custom reason code', async () => {
    const port = unavailableSyncOrchestratorPort('SOME_OTHER_REASON')
    expect(port.reasonCode).toBe('SOME_OTHER_REASON')
  })

  it('validates a sync run status row and keeps the three ids distinct', () => {
    const row = {
      syncRunId: 'fx-sync-1', engineExecutionId: 'fx-exec-1', providerReportJobId: 'fx-job-1',
      state: 'RUNNING', attempt: 1, scheduledAt: '2026-09-24T19:00:00.000Z', updatedAt: '2026-09-24T19:00:01.000Z',
    }
    expect(() => zSyncRunStatus.parse(row)).not.toThrow()
    expect(() => zSyncRunStatus.parse({ ...row, engineExecutionId: undefined })).toThrow()
    expect(() => zSyncRunStatus.parse({ ...row, engineExecutionId: null, providerReportJobId: null })).not.toThrow()
    expect(() => zSyncRunStatus.parse({ ...row, state: 'BOGUS' })).toThrow()
    expect(() => zSyncRunStatus.parse({ ...row, extra: true })).toThrow()
  })

  describe('fake orchestrator (test-only)', () => {
    it('reports the next 02:00 Bangkok tick', async () => {
      const port = createFakeSyncOrchestrator({ now: () => new Date('2026-09-24T18:30:00.000Z') })
      const tick = await port.nextScheduledTick()
      expect(tick).toEqual({ tickAt: '2026-09-24T19:00:00.000Z', timezone: 'Asia/Bangkok', hour: 2 })
    })

    it('accepts, coalesces, conflicts and reads status with distinct id fields', async () => {
      const port = createFakeSyncOrchestrator()
      const request = {
        assetId: 'fx-asset-infresh-page-a', dataset: 'DAILY_OBSERVATIONS',
        window: { from: '2026-09-01', to: '2026-09-28' }, idempotencyKey: 'fx-key-1',
      }
      const first = await port.submitManualRefresh({ request })
      expect(first.state).toBe('ACCEPTED')

      const retry = await port.submitManualRefresh({ request })
      expect(retry).toEqual(first)

      const coalesced = await port.submitManualRefresh({ request: { ...request, idempotencyKey: 'fx-key-2' } })
      expect(coalesced).toEqual({ syncRunId: first.syncRunId, state: 'COALESCED' })

      await expect(port.submitManualRefresh({
        request: { ...request, window: { from: '2026-08-01', to: '2026-08-28' } },
      })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' })

      const status = await port.readSyncStatus({ syncRunId: first.syncRunId })
      expect(status).toMatchObject({ syncRunId: first.syncRunId, engineExecutionId: null, providerReportJobId: null, state: 'ACCEPTED' })

      port._advance(first.syncRunId, { engineExecutionId: 'fx-exec-1', providerReportJobId: 'fx-job-1', state: 'RUNNING' })
      const advanced = await port.readSyncStatus({ syncRunId: first.syncRunId })
      expect(advanced).toMatchObject({ syncRunId: first.syncRunId, engineExecutionId: 'fx-exec-1', providerReportJobId: 'fx-job-1', state: 'RUNNING' })
      expect(() => zSyncRunStatus.parse(advanced)).not.toThrow()

      await expect(port.readSyncStatus({ syncRunId: 'fx-unknown' })).rejects.toMatchObject({ code: 'SYNC_RUN_NOT_FOUND' })
    })
  })
})
