import prisma from '@/lib/db'
import { assertMayView } from './line-oa-account-authority'

// @req FR-149 — a terminal `LineConversationJob` failure has no owner and no
//   surface today: of the 12 rows this Business's account has ever produced,
//   4 ended FAILED (LOCAL_POLICY_UNAVAILABLE) and nothing on any screen said
//   so. This read model answers one question honestly — how many conversation
//   jobs for this Business ended FAILED, and why — from the same
//   `LineConversationJob` rows `listLineConversationJobs` already reads. It
//   invents nothing: a null `errorCode` is reported as `null`, never guessed
//   at, and the total is the real, unwindowed count.
// @spec ADR-061, SEC-001 — same 404-on-refusal contract as every other LINE OA
//   Studio read (Business visibility plus the `line-oa` domain grant); the DTO
//   never exposes LINE ids, tokens or question/answer text.
// @tested tests/unit/line-job-failures.test.js

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

// Mirrors `listLineConversationJobs`'s select exactly, plus `accountId` (this
// view spans every account of the Business, not one account's queue) — never
// `answerText`, `sealedReplyToken`, `recipientId`, `sourceUserId` or
// `inboundMessageId`.
const FAILURE_SELECT = {
  id: true, accountId: true, status: true, executionMode: true, modelAccess: true,
  sendMethod: true, attempts: true, errorCode: true, acceptedAt: true,
  createdAt: true, updatedAt: true, version: true,
}

/**
 * Terminal FAILED `LineConversationJob` rows for one Business: the honest
 * total, a breakdown by `errorCode` (a null code is reported as `null`, never
 * relabelled), and the 20 most recently updated rows for a first look.
 */
export async function summarizeLineConversationJobFailures({ businessId, viewer, db = prisma } = {}) {
  const business = typeof businessId === 'string' ? businessId.trim() : ''
  if (!business) throw failure(400, 'LINE_OA_BUSINESS_REQUIRED')
  assertMayView(viewer, business)

  const where = { businessId: business, status: 'FAILED' }

  // Two reads, not three. The separate `count` asked for a number the groupBy already carries:
  // every FAILED row falls in exactly one errorCode bucket, `null` included, so summing the
  // buckets is not an estimate — it is the identical total, one round trip cheaper.
  //
  // Worth trimming because of where this runs. The card mounts on a provisioning screen that is
  // already issuing several requests, and on CI that extra contention pushed a *sibling's*
  // interactive transaction 45 ms past Prisma's 5 s default: account creation failed outright with
  // P2028 and was reported to the browser as a 400 (seen in the e2e traces for fr151 and fr149).
  // Raising that transaction's timeout is the real fix; not asking for an answer we already hold
  // is the part that belongs here.
  const [groups, failures] = await Promise.all([
    db.lineConversationJob.groupBy({ by: ['errorCode'], where, _count: { _all: true } }),
    db.lineConversationJob.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 20, select: FAILURE_SELECT }),
  ])

  const byErrorCode = groups
    .map((group) => ({ errorCode: group.errorCode ?? null, count: group._count._all }))
    .sort((a, b) => b.count - a.count)
  const total = byErrorCode.reduce((sum, bucket) => sum + bucket.count, 0)

  return { businessId: business, total, byErrorCode, failures }
}
