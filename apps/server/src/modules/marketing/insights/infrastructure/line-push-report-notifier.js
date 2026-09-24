// Marketing Insights (S6) — B5: ReportNotificationPort over Zuri's existing
// LINE OA, through an injected transport. This file contains no URL, no live
// call and no credential material: the transport is supplied by its caller
// (LINE OA Studio / Integration, per reconciliation decision R-16) and is the
// only thing that ever reaches a provider.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-16), contract §5 ("LINE alert naming brand and error"), SEC-001
// @tested tests/unit/marketing/insights/line-push-report-notifier.test.js
//
// Config: { credentialRef, recipients: [{ kind: 'user'|'group', id }],
// quotaNote, transport }. credentialRef is a NAME, never a token. Recipients
// are user-approved input, supplied later. Missing either one returns the
// honest unavailable port instead of guessing a recipient or a credential.
//
// Constraints this adapter documents rather than enforces at runtime: the
// push draws on the OA's own monthly message quota (quotaNote is carried
// through, never interpreted here), and every recipient must already be an
// approved contact — this module never discovers or infers one.

import { unavailablePort, insightsErrors } from '../ports/insights-ports'
import { buildSyncFailureAlertText, retryKeyForFailure } from '../domain/report-notification'

export const RECIPIENT_KINDS = Object.freeze(['user', 'group'])

function validRecipient(recipient) {
  return Boolean(recipient) && RECIPIENT_KINDS.includes(recipient.kind)
    && typeof recipient.id === 'string' && recipient.id.trim().length > 0
}

/**
 * `transport.push({ credentialRef, to, messages, retryKey })` resolves the
 * credential itself and returns `{ status, httpStatus, requestId, code }`
 * with `status` one of ACCEPTED_BY_LINE / RETRYABLE_FAILURE /
 * PERMANENT_FAILURE / UNKNOWN — the same shape the platform's own push
 * transport already returns, so a real binding can be dropped in without
 * reshaping this adapter.
 */
export function createLinePushReportNotifier({
  credentialRef = null, recipients = [], quotaNote = null, transport = null,
} = {}) {
  if (!credentialRef || typeof credentialRef !== 'string' || credentialRef.trim().length === 0) {
    return unavailablePort('ReportNotificationPort', 'CREDENTIAL_REF_NOT_CONFIGURED')
  }
  const validRecipients = Array.isArray(recipients) ? recipients.filter(validRecipient) : []
  if (validRecipients.length === 0) {
    return unavailablePort('ReportNotificationPort', 'RECIPIENT_NOT_CONFIGURED')
  }
  if (typeof transport?.push !== 'function') {
    throw new Error('createLinePushReportNotifier requires an injected transport with a push(...) method')
  }

  async function notify(failure) {
    const {
      syncRunId, failureKey, reasonCode, brandDisplayName, brandSlug, window,
    } = failure ?? {}
    const text = buildSyncFailureAlertText({
      brandDisplayName, brandSlug, reasonCode, syncRunId, window,
    })
    const messages = [{ type: 'text', text }]
    const results = []
    for (const recipient of validRecipients) {
      // One push per recipient, sequential: the shared hourly call budget
      // (R-17) is spent by the caller of this port, not raced here. The
      // retry key MUST vary per recipient: LINE's X-Line-Retry-Key is
      // checked per push request, so one shared key would get every push
      // after the first rejected as a duplicate and only the first
      // recipient would ever be alerted.
      const retryKey = retryKeyForFailure({
        syncRunId, failureKey: failureKey ?? reasonCode, recipientKind: recipient.kind, recipientId: recipient.id,
      })
      const result = await transport.push({
        credentialRef, to: recipient.id, messages, retryKey,
      })
      results.push({ recipient, retryKey, result })
    }
    const failed = results.filter(({ result }) => result?.status !== 'ACCEPTED_BY_LINE')
    if (results.length > 0 && failed.length === results.length) {
      throw insightsErrors.sourceUnavailable('LINE push report notifier: every recipient push failed')
    }
    return {
      sent: results.length - failed.length, failed: failed.length, quotaNote, results,
    }
  }

  return Object.freeze({
    capability: 'ReportNotificationPort', available: true, reasonCode: null, quotaNote, invoke: notify,
  })
}
