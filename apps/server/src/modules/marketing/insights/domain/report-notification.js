// Marketing Insights (S6) — sync failure alert content. Pure: no LINE client,
// no live call, no credential material. Everything here is text formatting
// and a deterministic identifier derived from the failure, never a request.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-16 notification replacement), contract §5 ("LINE alert naming brand
//   and error")
// @tested tests/unit/marketing/insights/report-notification.test.js
//
// The message body carries exactly four things: the brand's own display
// name, a safe reason code from a closed allow-list, the internal syncRunId
// for correlation, and the report window. Nothing else may ever appear here:
// no token, no raw provider payload, no customer data, no provider error
// prose. A reasonCode outside the allow-list is refused rather than
// forwarded, so a future provider error string can never reach the body.

import { createHash } from 'node:crypto'

// A fixed, arbitrary namespace UUID for this alert family (RFC 4122 §4.3).
// Any valid UUID works as a namespace; this one is not derived from anything
// and carries no meaning beyond being stable across runs.
const RETRY_KEY_NAMESPACE = '2b8f7a10-8c2b-4b8e-9d0a-6f1c2e9a7d41'

export const ALERT_TEXT_MAX_LENGTH = 5000 // LINE Messaging API text message limit

export const SAFE_ALERT_REASON_CODES = Object.freeze([
  'AUTH_ERROR', 'SCHEMA_ERROR', 'PERMISSION_ERROR', 'TRANSIENT_ERROR', 'RATE_LIMITED', 'UNKNOWN_ERROR',
])

export class ReportNotificationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ReportNotificationError'
    this.code = 'INVALID_ALERT_INPUT'
  }
}

function oneLine(value, maxLength) {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\r\n\t\u0000-\u001f]+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned
}

function uuidV5(name, namespaceUuid) {
  const namespaceBytes = Buffer.from(namespaceUuid.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(namespaceBytes).update(Buffer.from(name, 'utf8')).digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Deterministic per the failure intent: the same syncRunId + failureKey
 * always produce the same retry key, so a repeated call for the same failure
 * reaches the provider's own idempotency check instead of sending twice.
 */
export function retryKeyForFailure({ syncRunId, failureKey }) {
  if (!syncRunId || typeof syncRunId !== 'string') throw new ReportNotificationError('syncRunId is required')
  if (!failureKey || typeof failureKey !== 'string') throw new ReportNotificationError('failureKey is required')
  return uuidV5(`${syncRunId}|${failureKey}`, RETRY_KEY_NAMESPACE)
}

/**
 * Thai-first alert body with the safe code as a second line (contract §5:
 * "naming the brand and error"). Bilingual so an on-call reader and a
 * dashboard grep both work from the same line.
 */
export function buildSyncFailureAlertText({ brandDisplayName, brandSlug, reasonCode, syncRunId, window } = {}) {
  if (!SAFE_ALERT_REASON_CODES.includes(reasonCode)) {
    throw new ReportNotificationError(`reasonCode is not on the safe alert allow-list: ${String(reasonCode).slice(0, 40)}`)
  }
  const brand = oneLine(brandDisplayName, 100) ?? oneLine(brandSlug, 40)
  const runId = oneLine(syncRunId, 80)
  if (!brand) throw new ReportNotificationError('brandDisplayName or brandSlug is required')
  if (!runId) throw new ReportNotificationError('syncRunId is required')
  const from = oneLine(window?.from, 10)
  const to = oneLine(window?.to, 10)
  if (!from || !to) throw new ReportNotificationError('window.from and window.to are required')
  const text = [
    `แจ้งเตือน: การซิงค์ข้อมูล Insights ล้มเหลว — ${brand}`,
    `รหัส: ${reasonCode}`,
    `รอบซิงค์: ${runId}`,
    `ช่วงเวลา: ${from} – ${to}`,
  ].join('\n')
  return text.length > ALERT_TEXT_MAX_LENGTH ? text.slice(0, ALERT_TEXT_MAX_LENGTH) : text
}
