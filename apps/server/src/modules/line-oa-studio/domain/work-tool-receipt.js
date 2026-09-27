// @req FR-150 — a WorkTool response is valid only in the exact v1 shape Core emits
// for the request that was sent: each operation has one receipt shape, and the
// receipt must name the proposal or job the request named. Core checks its own
// response with this before it leaves (validateResult), and the runtime client
// checks the same response with this when it arrives, so a drifted Core fails at
// Core instead of a malformed receipt reaching a turn and its durable replay.
//   read            COMPLETED  { source: 'PROJECT_MANAGER', observedAt }
//   propose         COMPLETED  { proposalId: <claim job>, status: 'AWAITING_CONFIRMATION' }
//   confirm-execute COMPLETED  { proposalId, action, itemId, code, status, version, duplicate?: true }
//   status          COMPLETED  the propose receipt (for `<job>:work-proposal`) or the
//                              confirm-execute receipt without `duplicate`
//                   NOT_FOUND  { operationId } | { proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } }
//   any but status  REJECTED   { code: one of WORK_REJECTION_CODES, result: { text } } (W1)
// @spec ADR-106 D2-D4, SDD-110 — pure shape rules, no I/O and no imports.
//
// ONE SOURCE, TWO PLACES. This file exists byte for byte at
//   apps/server/src/modules/line-oa-studio/domain/work-tool-receipt.js   (authored here)
//   services/conversation-runtime/src/work-tool-receipt.js               (mirror)
// The Runtime may not import apps/server and the apps/server image cannot reach
// services/, so a shared import is not possible for both images. Edit the
// apps/server copy, then copy it over the mirror unchanged. The drift test fails on
// any difference.
// @tested tests/integration/conversation-runtime-work-tool-port.test.js,
//   services/conversation-runtime/test/contracts.test.js

// A Work domain refusal Core returns as a final, typed outcome with the legacy reply.
export const WORK_REJECTION_CODES = Object.freeze(['WORK_CONFIRMATION_EXPIRED', 'WORK_VERSION_CONFLICT', 'WORK_ACTION_UNAVAILABLE'])
export const WORK_TOOL_TEXT_MAX = 5000
export const WORK_TOOL_RESULT_MAX_BYTES = 32 * 1024

const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const exactKeys = (value, keys) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

function jsonWithin(value, maxBytes) {
  const pending = [{ value, depth: 0 }]
  const seen = new WeakSet()
  while (pending.length) {
    const current = pending.pop()
    if (current.depth > 64) return false
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false
      continue
    }
    if (!current.value || typeof current.value !== 'object') return false
    if (seen.has(current.value)) return false
    seen.add(current.value)
    for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 })
  }
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && new TextEncoder().encode(serialized).length <= maxBytes
  } catch { return false }
}

/**
 * Whether `data` is a valid v1 WorkTool response to `request` (the v1 `work-tool`
 * payload: `claim.jobId`, `operation`, `operationId`, `input`).
 */
export function isValidWorkToolResult(request, data) {
  const claimJobId = request?.claim?.jobId
  const proposalReceipt = receipt => exactKeys(receipt, ['proposalId', 'status'])
    && receipt.status === 'AWAITING_CONFIRMATION' && bounded(receipt.proposalId, 128) && receipt.proposalId === claimJobId
  const executionReceipt = (receipt, proposalId, { duplicateAllowed }) => {
    const keys = ['proposalId', 'action', 'itemId', 'code', 'status', 'version']
    if (duplicateAllowed && receipt && Object.hasOwn(receipt, 'duplicate')) {
      if (receipt.duplicate !== true) return false
      keys.push('duplicate')
    }
    return exactKeys(receipt, keys) && receipt.proposalId === proposalId && bounded(receipt.proposalId, 128)
      && ['create_work', 'update_work'].includes(receipt.action) && bounded(receipt.itemId, 128) && bounded(receipt.code, 64)
      && typeof receipt.status === 'string' && /^[A-Z][A-Z_]{0,31}$/.test(receipt.status)
      && Number.isInteger(receipt.version) && receipt.version >= 1
  }
  const readReceipt = receipt => exactKeys(receipt, ['source', 'observedAt']) && receipt.source === 'PROJECT_MANAGER'
    && typeof receipt.observedAt === 'string' && receipt.observedAt.length <= 40 && Number.isFinite(Date.parse(receipt.observedAt))
  if (!data || typeof data !== 'object' || Array.isArray(data) || !jsonWithin(data, WORK_TOOL_RESULT_MAX_BYTES)) return false
  const operation = request?.operation
  if (data.status === 'REJECTED') {
    return exactKeys(data, ['status', 'code', 'result']) && WORK_REJECTION_CODES.includes(data.code)
      && exactKeys(data.result, ['text']) && bounded(data.result.text, WORK_TOOL_TEXT_MAX)
  }
  if (data.status === 'COMPLETED') {
    if (!exactKeys(data, ['status', 'result']) || !exactKeys(data.result, ['text', 'receipt'])
      || !bounded(data.result.text, WORK_TOOL_TEXT_MAX)) return false
    const receipt = data.result.receipt
    return operation === 'read' ? readReceipt(receipt)
      : operation === 'propose' ? proposalReceipt(receipt)
        : operation === 'confirm-execute' ? executionReceipt(receipt, request.input?.proposalId, { duplicateAllowed: true })
          : operation === 'status'
            ? (request.operationId === `${claimJobId}:work-proposal` ? proposalReceipt(receipt)
              : executionReceipt(receipt, request.input?.proposalId ?? request.operationId, { duplicateAllowed: false }))
            : false
  }
  // Only a status probe can find nothing; every other operation either completes or fails.
  if (data.status !== 'NOT_FOUND' || operation !== 'status') return false
  const probed = request.input?.proposalId ?? request.operationId
  return (exactKeys(data, ['status', 'operationId']) && data.operationId === request.operationId)
    || (exactKeys(data, ['status', 'proposalId', 'receipt']) && data.proposalId === probed && bounded(data.proposalId, 128)
      && exactKeys(data.receipt, ['status']) && data.receipt.status === 'AWAITING_CONFIRMATION')
}
