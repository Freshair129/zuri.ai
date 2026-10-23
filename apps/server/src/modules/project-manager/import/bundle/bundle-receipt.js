import { readPipelineState, pipelineReleaseScopes } from '../../application/pipeline-state'
import { createHash } from 'node:crypto'
import { recordAudit } from '../../application/audit'

// @req FR-108 — bundle idempotency and audit lineage (ADR-049 D9).
// @spec ADR-049, SDD-056, BR-002, SEC-003
// @tested tests/integration/execution-plan-bundle.test.js
//
// The compatibility receipt still REUSES the existing `PlanImportReceipt`
// model. The PM-owned `ProjectExecutionRun`/`ProjectExecutionStep` ledger is
// now the step authority; this receipt remains the cross-version idempotency
// projection. A bundle occurrence is one more step kind in that projection,
// distinguished by
// `stepKey = 'bundle.import.commit'` (per-Project rows keep their default
// 'plan.import.commit'). `projectId` is a required relation on the model, so
// the bundle row anchors on the FIRST Project the bundle committed — a bundle
// always has >= 1 — and the full receipt, including the per-Project lineage
// (D9: which PlanEnvelope receipts/runs this package occurrence caused), lives
// in the linked BUNDLE_IMPORTED AuditEvent payload, where replay reads it
// back. Keys share one namespace with per-Project receipts; a key reused
// across the two kinds fails the payload-hash equality check and is refused —
// which is the correct answer for a key that already means something else.

export const BUNDLE_STEP_KEY = 'bundle.import.commit'
export const BUNDLE_AUDIT_ACTION = 'BUNDLE_IMPORTED'

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalize(value[key])
        return result
      }, {})
  }
  return value
}

/** Stable hash of the normalized (Zod-parsed, key-sorted) bundle payload. */
export function normalizedBundleHash(bundle) {
  return createHash('sha256').update(JSON.stringify(canonicalize(bundle))).digest('hex')
}

/**
 * Look up a prior bundle receipt for this idempotency key inside the commit
 * transaction. Returns:
 *   null                                  — no prior occurrence; proceed.
 *   { conflict: true, errors }            — key reused with a different payload.
 *   { replay: true, receipt }             — same key + same payload: the prior
 *                                           receipt, read back from the audit
 *                                           event the first run wrote. Replay
 *                                           never mutates historical records.
 */
export async function findBundleReplay(tx, { idempotencyKey, payloadHash, actor, businessId }) {
  const existing = await tx.planImportReceipt.findUnique({ where: { idempotencyKey } })
  if (!existing) return null
  if (existing.payloadHash !== payloadHash || existing.stepKey !== BUNDLE_STEP_KEY) {
    return {
      conflict: true,
      errors: ['IDEMPOTENCY_CONFLICT: already used with a different payload'],
    }
  }
  let receipt = null
  if (existing.auditEventId) {
    const auditEvent = await tx.auditEvent.findUnique({ where: { id: existing.auditEventId } })
    try {
      const payload = JSON.parse(auditEvent?.payloadJson ?? 'null')
      // Historical Bundle1.0 recorded no actor. Its freshly authorized Business,
      // exact payload and original audit/receipt lineage remain the replay fence.
      const actorMatches=payload && (Object.hasOwn(payload,'receiptActor') ? payload.receiptActor === actor : existing.schemaVersion === '1.0' && payload.schemaVersion === '1.0')
      if(!actorMatches || payload?.businessId !== businessId || payload?.payloadHash !== payloadHash || payload?.idempotencyKey !== idempotencyKey || auditEvent?.action !== BUNDLE_AUDIT_ACTION || auditEvent?.entityType !== 'EXECUTION_PLAN_BUNDLE' || auditEvent?.entityId !== existing.executionRunId || payload?.receipt?.bundleRunId !== existing.executionRunId) return {conflict:true,errors:['IDEMPOTENCY_CONFLICT: already used with a different payload']}
      receipt = payload?.receipt ?? null
    } catch {
      receipt = null
    }
  }
  if(!receipt) return {conflict:true,errors:['IDEMPOTENCY_CONFLICT: already used with a different payload']}
  return {replay:true,receipt}
}

/**
 * Record one accepted bundle occurrence: the BUNDLE_IMPORTED audit event
 * carrying the full receipt (bundle → per-Project lineage), and — when the
 * bundle carries an idempotency key — the PlanImportReceipt ledger row that
 * makes replay and hash-conflict detection possible. Must run inside the
 * commit transaction so a failed bundle leaves neither.
 */
export async function recordBundleReceipt(tx, { bundle, business, payloadHash, receipt, auditEventId = null, actorPersonId = null, tenantId = null, receiptActor = null }) {
  const idempotencyKey = bundle.trace?.idempotencyKey ?? null
  const correlationId = bundle.trace?.correlationId ?? null

  const auditEvent = await recordAudit(tx, {
    id: auditEventId, actorId: actorPersonId, tenantId, businessId: actorPersonId ? business.id : null,
    entityType: 'EXECUTION_PLAN_BUNDLE',
    entityId: receipt.bundleRunId,
    action: BUNDLE_AUDIT_ACTION,
    actorType: 'AGENT_PLAN',
    payload: {
      receiptActor,
      manifestCode: bundle.manifest.code,
      businessId: business.id,
      businessCode: business.code,
      schemaVersion: bundle.schemaVersion,
      idempotencyKey,
      correlationId,
      payloadHash,
      receipt,
      ...(actorPersonId ? { releaseScopes: pipelineReleaseScopes(await readPipelineState(tx), receipt.projects.map(project => project.projectId)), stateImages: (await tx.dependency.findMany({ where: { id: { in: receipt.dependencies.filter(edge => !edge.existed).map(edge => edge.id) } } })).map(row => ({ type: 'DEPENDENCY', id: row.id, before: null, after: row })) } : {}),
    },
  })

  if (idempotencyKey) {
    await tx.planImportReceipt.create({
      data: {
        idempotencyKey,
        payloadHash,
        executionRunId: receipt.bundleRunId,
        stepKey: BUNDLE_STEP_KEY,
        status: 'SUCCEEDED',
        correlationId: correlationId ?? idempotencyKey,
        schemaVersion: bundle.schemaVersion,
        projectId: receipt.projects[0].projectId,
        auditEventId: auditEvent.id,
      },
    })
  }

  return auditEvent
}
