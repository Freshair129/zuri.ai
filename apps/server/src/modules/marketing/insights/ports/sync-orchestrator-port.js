// Marketing Insights (S6) — B4: SyncOrchestratorPort. The pure sync policies
// (refresh coalescing, retry, rate budget, schedule) are engine-agnostic on
// purpose: nothing under insights/ names a specific workflow engine, so any
// engine can sit behind this port later without touching the policies —
// that is what "pluggable" means here.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-12 refresh control endpoint; the reconciliation doc's Ports table
//   records which concrete engine the coordination context intends)
// @tested tests/unit/marketing/insights/sync-orchestrator-port.test.js
//
// Methods: nextScheduledTick() reads when the daily tick fires;
// submitManualRefresh({ request }) returns only { syncRunId, state } — never
// report data; readSyncStatus({ syncRunId }) keeps the internal syncRunId,
// the engine's own execution id and the provider's report-job id as three
// distinct, independently-nullable fields, because one engine run can retry
// under several execution ids and a provider job can outlive a failed one.

import { z } from 'zod'
import { PORT_VERSION, insightsErrors } from './insights-ports'

export const SYNC_ORCHESTRATOR_METHODS = Object.freeze(['nextScheduledTick', 'submitManualRefresh', 'readSyncStatus'])

export const SYNC_RUN_STATES = Object.freeze([
  'ACCEPTED', 'COALESCED', 'RUNNING', 'RETRY_SCHEDULED', 'DEFERRED', 'SUCCEEDED', 'FINAL_FAILURE',
])

export const zSyncRunStatus = z.object({
  syncRunId: z.string().min(1),
  engineExecutionId: z.string().min(1).nullable(),
  providerReportJobId: z.string().min(1).nullable(),
  state: z.enum(SYNC_RUN_STATES),
  attempt: z.number().int().nonnegative(),
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict()

export function assertSyncOrchestratorPort(port) {
  for (const method of SYNC_ORCHESTRATOR_METHODS) {
    if (typeof port?.[method] !== 'function') throw new Error(`SyncOrchestratorPort must implement ${method}()`)
  }
  return port
}

/** The honest default until an orchestration owner supplies a reviewed adapter (B4). */
export function unavailableSyncOrchestratorPort(reasonCode = 'WORKFLOW_ENGINE_OWNER_UNASSIGNED') {
  const refuse = async () => { throw insightsErrors.capabilityUnavailable('SyncOrchestratorPort', reasonCode) }
  return Object.freeze({
    capability: 'SyncOrchestratorPort',
    available: false,
    reasonCode,
    version: PORT_VERSION,
    nextScheduledTick: refuse,
    submitManualRefresh: refuse,
    readSyncStatus: refuse,
  })
}

export const WORKFLOW_ENGINE_SYNC_ORCHESTRATOR_PORT = unavailableSyncOrchestratorPort()
