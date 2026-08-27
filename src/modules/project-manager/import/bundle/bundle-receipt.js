import { createHash } from 'node:crypto'
import { recordAudit } from '../../application/audit'

// @req FR-108 — bundle idempotency and audit lineage (ADR-049 D9).
// @spec ADR-049, SDD-056, BR-002, SEC-003
// @tested tests/integration/execution-plan-bundle.test.js
//
// The bundle receipt REUSES the existing `PlanImportReceipt` model rather than
// adding a table (first preference of the FR-108 slice — no schema change):
// the model is exactly an idempotency ledger (`idempotencyKey` @id +
// `payloadHash` + run identity + `auditEventId`), and a bundle occurrence is
// one more step kind in that ledger, distinguished by
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
export async function findBundleReplay(tx, { idempotencyKey, payloadHash }) {
  const existing = await tx.planImportReceipt.findUnique({ where: { idempotencyKey } })
  if (!existing) return null
  if (existing.payloadHash !== payloadHash || existing.stepKey !== BUNDLE_STEP_KEY) {
    return {
      conflict: true,
      errors: [`Idempotency key "${idempotencyKey}" was already used with a different payload`],
    }
  }
  let receipt = null
  if (existing.auditEventId) {
    const auditEvent = await tx.auditEvent.findUnique({ where: { id: existing.auditEventId } })
    try {
      receipt = JSON.parse(auditEvent?.payloadJson ?? 'null')?.receipt ?? null
    } catch {
      receipt = null
    }
  }
  return {
    replay: true,
    receipt: receipt ?? {
      bundleRunId: existing.executionRunId,
      idempotencyKey: existing.idempotencyKey,
      status: existing.status,
    },
  }
}

/**
 * Record one accepted bundle occurrence: the BUNDLE_IMPORTED audit event
 * carrying the full receipt (bundle → per-Project lineage), and — when the
 * bundle carries an idempotency key — the PlanImportReceipt ledger row that
 * makes replay and hash-conflict detection possible. Must run inside the
 * commit transaction so a failed bundle leaves neither.
 */
export async function recordBundleReceipt(tx, { bundle, business, payloadHash, receipt }) {
  const idempotencyKey = bundle.trace?.idempotencyKey ?? null
  const correlationId = bundle.trace?.correlationId ?? null

  const auditEvent = await recordAudit(tx, {
    entityType: 'EXECUTION_PLAN_BUNDLE',
    entityId: receipt.bundleRunId,
    action: BUNDLE_AUDIT_ACTION,
    actorType: 'AGENT_PLAN',
    payload: {
      manifestCode: bundle.manifest.code,
      businessId: business.id,
      businessCode: business.code,
      schemaVersion: bundle.schemaVersion,
      idempotencyKey,
      correlationId,
      payloadHash,
      receipt,
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
