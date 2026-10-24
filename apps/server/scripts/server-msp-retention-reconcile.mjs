#!/usr/bin/env node
// @req FR-230 — deployment-operator recovery after the old container is stopped.
// @spec SEC-031, ADR-091
// @tested tests/unit/msp-retention-route-worker.test.js
import { resolveMspRetentionWorkerConfig } from './msp-retention-worker-run.mjs'
import { readFileSync } from 'node:fs'
try {
  if (process.argv.length !== 2) throw new Error('INVALID_ARGUMENT')
  const raw = readFileSync(0, 'utf8')
  if (raw.length > 1024) throw new Error('INVALID_ARGUMENT')
  const input = JSON.parse(raw), runId = input.reconcileRunId
  if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error('INVALID_ARGUMENT')
  const { endpoint, token } = resolveMspRetentionWorkerConfig()
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(input) })
  const body = await response.json()
  const ok = response.ok && body.ok === true && body.reconciled === true && body.runId === runId
  console.log(JSON.stringify({ event: 'msp.retention-reconcile', ok, runId, status: response.status }))
  process.exitCode = ok ? 0 : 1
} catch { console.log('{"event":"msp.retention-reconcile","ok":false}'); process.exitCode = 1 }
