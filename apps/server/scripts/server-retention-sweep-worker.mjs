#!/usr/bin/env node
// @req FR-230 — single-shot nightly retention sweep worker: authenticate to
//   POST /api/crm/retention-sweep once, log the JSON result, exit. Unlike
//   `server-line-worker.mjs` this is NOT a supervised polling loop — there is
//   no cadence, no backoff, no SIGTERM/SIGINT handling to drain in-flight work,
//   because there is never more than one in-flight call. The daily cadence is
//   the host's own scheduler's job (see scripts/register-retention-sweep-task.ps1),
//   not this process's: it runs once and stops, the way `cron`/Task Scheduler
//   expects a one-shot job to behave.
// @spec ADR-091 D1, D2 — the owner's decision (2026-09-14) to run the sweep once
//   a day at 03:00 local time, via this repo's existing worker pattern.
// @tested tests/unit/retention-sweep-worker-run.test.js — the core this script
//   is a thin wrapper around; the wrapper itself is exercised by
//   tests/unit/server-retention-sweep-worker-script.test.js (shape only, no
//   live network call — see the file-shape checks there for why).
import { formatRetentionSweepLogLine, resolveRetentionSweepWorkerConfig, runRetentionSweepOnce } from './retention-sweep-worker-run.mjs'

const { endpoint, token } = resolveRetentionSweepWorkerConfig(process.env)
const result = await runRetentionSweepOnce({ endpoint, token })
console.log(formatRetentionSweepLogLine(result))
process.exit(result.ok ? 0 : 1)
