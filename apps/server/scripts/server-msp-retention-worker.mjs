#!/usr/bin/env node
// @req FR-230 — one invocation, one result, scheduler owns nightly cadence.
// @spec SEC-031, ADR-091
// @tested tests/unit/msp-retention-route-worker.test.js
import { resolveMspRetentionWorkerConfig, runMspRetentionOnce, formatMspRetentionLog } from './msp-retention-worker-run.mjs'
try {
  if (process.argv.slice(2).some(arg => arg !== '--dry-run') || process.argv.length > 3) throw new Error('INVALID_ARGUMENT')
  const result = await runMspRetentionOnce({ ...resolveMspRetentionWorkerConfig(), dryRun: process.argv.includes('--dry-run') })
  console.log(formatMspRetentionLog(result))
  process.exitCode = result.ok ? 0 : 1
} catch {
  console.log(formatMspRetentionLog({ ok: false, status: null, error: 'CONFIGURATION_INVALID' }))
  process.exitCode = 1
}
