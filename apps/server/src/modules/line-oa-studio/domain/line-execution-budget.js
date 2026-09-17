// @req FR-150 — server authority for negotiated Edge execution budgets.
// @spec ADR-061 — execution leases never extend LINE reply lifetimes.
// @tested tests/integration/server-line-jobs.test.js
export const LINE_REPLY_SEND_RESERVE_MS = 5000

export function lineExecutionBudget(job, issuedAt) {
  const replyDeadline = job.replyExpiresAt?.getTime() ?? 0
  const delayed = (!job.sealedReplyToken || replyDeadline <= issuedAt.getTime()) && job.allowDelayedPush === true
  const end = delayed
    ? Math.min(job.leaseExpiresAt.getTime() - 15000, issuedAt.getTime() + 240000)
    : replyDeadline - LINE_REPLY_SEND_RESERVE_MS
  return {
    issuedAt: issuedAt.toISOString(), answerDeadlineAt: new Date(Math.max(0, end)).toISOString(),
    remainingBudgetMs: Math.max(0, Math.min(delayed ? 240000 : 40000, end - issuedAt.getTime())),
    deliveryMode: delayed ? 'DELAYED_PUSH' : 'REPLY',
  }
}
