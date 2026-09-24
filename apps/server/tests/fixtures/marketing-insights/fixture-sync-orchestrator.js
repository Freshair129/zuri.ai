// SYNTHETIC FIXTURE — an in-memory FAKE SyncOrchestratorPort for tests only.
// Not a workflow engine adapter: it exists to prove the pure policies
// (coalescing, schedule) compose correctly, never to be run against a real
// orchestration engine. Every id here is synthetic (prefix `fx-`).

import { planRefreshRequest } from '@/modules/marketing/insights/domain/sync-refresh-request'
import { nextScheduledSyncTick, SYNC_SCHEDULE_TIMEZONE, SYNC_SCHEDULE_HOUR } from '@/modules/marketing/insights/domain/sync-schedule'

const OPEN_STATES = new Set(['ACCEPTED', 'RUNNING', 'RETRY_SCHEDULED', 'DEFERRED'])

export function createFakeSyncOrchestrator({ now = () => new Date(), idPrefix = 'fx-sync' } = {}) {
  const runs = new Map()
  let counter = 0

  return {
    capability: 'SyncOrchestratorPort',
    available: true,
    reasonCode: null,

    async nextScheduledTick() {
      const tick = nextScheduledSyncTick(now())
      return { tickAt: tick.toISOString(), timezone: SYNC_SCHEDULE_TIMEZONE, hour: SYNC_SCHEDULE_HOUR }
    },

    async submitManualRefresh({ request }) {
      const pending = [...runs.values()].filter((run) => OPEN_STATES.has(run.state))
      const plan = planRefreshRequest({
        request,
        pendingRuns: pending,
        generateSyncRunId: () => `${idPrefix}-${++counter}`,
      })
      if (plan.state === 'ACCEPTED' && !runs.has(plan.syncRunId)) {
        runs.set(plan.syncRunId, {
          syncRunId: plan.syncRunId,
          idempotencyKey: request.idempotencyKey,
          requestSignature: plan.requestSignature,
          engineExecutionId: null,
          providerReportJobId: null,
          state: 'ACCEPTED',
          attempt: 0,
          scheduledAt: null,
          updatedAt: now().toISOString(),
        })
      }
      return { syncRunId: plan.syncRunId, state: plan.state }
    },

    async readSyncStatus({ syncRunId }) {
      const run = runs.get(syncRunId)
      if (!run) throw Object.assign(new Error(`unknown syncRunId: ${syncRunId}`), { code: 'SYNC_RUN_NOT_FOUND', status: 404 })
      const { idempotencyKey, requestSignature, ...status } = run
      return status
    },

    // Test-only: advance a run's state to simulate the engine's own progress.
    _advance(syncRunId, patch) {
      const run = runs.get(syncRunId)
      if (!run) throw new Error(`unknown syncRunId: ${syncRunId}`)
      Object.assign(run, patch, { updatedAt: now().toISOString() })
      return { ...run }
    },
  }
}
