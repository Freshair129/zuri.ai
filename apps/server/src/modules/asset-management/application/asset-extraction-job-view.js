// @req FR-143 — the Thai job state the evidence review surface renders, and the
//   request builders its controls use. Pure by design: the page renders what this
//   returns, and a test can assert every state without a browser.
// @spec ADR-059, SDD-085
// @tested tests/unit/asset-extraction-job-view.test.js

/** Whether the surface should keep polling for this job. */
export function isJobPending(job) {
  return job?.status === 'QUEUED' || job?.status === 'CLAIMED'
}

/**
 * One line of Thai describing where the job is, for the reviewer.
 *
 * A FAILED job always carries its reason: "ล้มเหลว" with no cause is the state
 * that sends an operator to the logs, which is exactly what a status line is
 * supposed to save them from.
 */
export function describeExtractionJob(job) {
  if (!job) return { tone: 'idle', text: 'ยังไม่ได้ส่งให้ Edge Device ประมวลผล', pending: false }
  switch (job.status) {
    case 'QUEUED':
      return { tone: 'waiting', text: 'รอ Edge Device รับงาน', pending: true }
    case 'CLAIMED':
      return { tone: 'working', text: `Edge Device ${job.claimedByDeviceId || '—'} กำลังประมวลผล`, pending: true }
    case 'COMPLETED':
      return { tone: 'done', text: 'เสร็จแล้ว', pending: false }
    case 'FAILED':
      return { tone: 'error', text: `ล้มเหลว: ${job.lastError || 'ไม่ทราบสาเหตุ'}`, pending: false }
    case 'CANCELLED':
      return { tone: 'idle', text: 'ยกเลิกแล้ว', pending: false }
    default:
      return { tone: 'idle', text: `สถานะไม่รู้จัก: ${job.status}`, pending: false }
  }
}

export function extractionJobPath(evidenceId) {
  return evidenceId ? `/api/assets/evidence/${encodeURIComponent(evidenceId)}/extraction-job` : null
}

export function extractRequest(evidenceId, businessId) {
  return {
    path: `/api/assets/evidence/${encodeURIComponent(evidenceId)}/extract`,
    init: { method: 'POST', headers: { 'x-zuri-business-id': businessId } },
  }
}
