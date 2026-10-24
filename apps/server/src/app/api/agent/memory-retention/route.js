import { NextResponse } from 'next/server'
import { bearerMatches } from '@/modules/platform-control/application/programme-usage-reports'
import { runMspRetentionSweep, reconcileMspRetentionRun } from '@/modules/agent/msp-retention-service'

// @req FR-230 — operator-authenticated maintenance, with no model-selected scope.
// @spec SEC-001, SEC-031, ADR-091
// @tested tests/unit/msp-retention-route-worker.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  if (!bearerMatches(request.headers.get('authorization'), process.env.ZURI_MSP_RETENTION_SWEEP_TOKEN)) {
    return NextResponse.json({ error: 'MSP_RETENTION_CREDENTIAL_REQUIRED' }, { status: 401 })
  }
  const query = new URL(request.url).searchParams
  if ([...query.keys()].some(k => k !== 'dry_run') || query.getAll('dry_run').length > 1
    || (query.has('dry_run') && !['true', 'false'].includes(query.get('dry_run')))) {
    return NextResponse.json({ error: 'MSP_RETENTION_REQUEST_INVALID' }, { status: 400 })
  }
  // Sweep reads no body. Recovery accepts only the deployment operator's exact
  // run/stopped-container attestation; no supplied Tenant or clock is accepted.
  try {
    if (request.body !== null) {
      const raw = await request.text()
      if (raw.length > 1024) return NextResponse.json({ error: 'MSP_RETENTION_REQUEST_INVALID' }, { status: 400 })
      let body
      try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'MSP_RETENTION_REQUEST_INVALID' }, { status: 400 }) }
      if (query.size || !body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'proof,reconcileRunId,stoppedContainerId') {
        return NextResponse.json({ error: 'MSP_RETENTION_REQUEST_INVALID' }, { status: 400 })
      }
      const result = await reconcileMspRetentionRun({ runId: body.reconcileRunId, stoppedContainerId: body.stoppedContainerId, proof: body.proof })
      return NextResponse.json(result)
    }
    const result = await runMspRetentionSweep({ dryRun: query.get('dry_run') === 'true' })
    return NextResponse.json(result, { status: result.ok ? 200 : 503 })
  } catch {
    return NextResponse.json({ error: 'MSP_RETENTION_UNAVAILABLE' }, { status: 503 })
  }
}
