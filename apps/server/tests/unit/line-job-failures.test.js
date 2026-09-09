import { describe, expect, it, vi } from 'vitest'
import { summarizeLineConversationJobFailures } from '@/modules/line-oa-studio/application/line-job-failures'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-149 — the honest, red count of terminal FAILED conversation jobs.
// @spec ADR-061, SEC-001
// @tested this file

const BUSINESS_ID = 'biz-1'

function dbDouble({ total = 0, groups = [], rows = [] } = {}) {
  const count = vi.fn(async () => total)
  const groupBy = vi.fn(async () => groups)
  const findMany = vi.fn(async () => rows)
  return { db: { lineConversationJob: { count, groupBy, findMany } }, count, groupBy, findMany }
}

const viewerFor = (businessId) => makeViewer({
  visibleBusinessIds: [businessId],
  ownedBusinessIds: [businessId],
  visibleDomains: ['line-oa'],
})

describe('FR-149 job-failure summary — authorization', () => {
  it('refuses a Business the viewer cannot see with the same 404 an unknown Business gets', async () => {
    const { db, count } = dbDouble()
    const viewer = viewerFor('biz-owned')
    await expect(
      summarizeLineConversationJobFailures({ businessId: 'biz-not-visible', viewer, db }),
    ).rejects.toMatchObject({ status: 404 })
    expect(count).not.toHaveBeenCalled()
  })

  it('refuses a Business the viewer sees but does not own the LINE OA domain grant for, same shape as ownsElsewhere', async () => {
    const { db } = dbDouble()
    const viewer = ownsElsewhere({ owns: 'biz-owned', sees: 'biz-not-visible', seesDomains: ['projects'] })
    await expect(
      summarizeLineConversationJobFailures({ businessId: 'biz-not-visible', viewer, db }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses a missing businessId with 400 before touching the database', async () => {
    const { db, count, groupBy, findMany } = dbDouble()
    await expect(
      summarizeLineConversationJobFailures({ businessId: '  ', viewer: viewerFor(BUSINESS_ID), db }),
    ).rejects.toMatchObject({ status: 400, message: 'LINE_OA_BUSINESS_REQUIRED' })
    await expect(
      summarizeLineConversationJobFailures({ viewer: viewerFor(BUSINESS_ID), db }),
    ).rejects.toMatchObject({ status: 400 })
    expect(count).not.toHaveBeenCalled()
    expect(groupBy).not.toHaveBeenCalled()
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('FR-149 job-failure summary — the honest shape', () => {
  it('returns total: 0 and empty lists when there are no failures', async () => {
    const { db } = dbDouble({ total: 0, groups: [], rows: [] })
    const result = await summarizeLineConversationJobFailures({ businessId: BUSINESS_ID, viewer: viewerFor(BUSINESS_ID), db })
    expect(result).toEqual({ businessId: BUSINESS_ID, total: 0, byErrorCode: [], failures: [] })
  })

  it('returns the honest total, the per-errorCode breakdown descending by count, and a null errorCode reported as null', async () => {
    const { db, count, groupBy, findMany } = dbDouble({
      total: 4,
      groups: [
        { errorCode: 'LOCAL_POLICY_UNAVAILABLE', _count: { _all: 3 } },
        { errorCode: null, _count: { _all: 1 } },
      ],
      rows: [
        { id: 'job-1', accountId: 'acct-1', status: 'FAILED', executionMode: 'EDGE', modelAccess: 'LOCAL_ONLY', sendMethod: null, attempts: 1, errorCode: 'LOCAL_POLICY_UNAVAILABLE', acceptedAt: null, createdAt: new Date(0), updatedAt: new Date(1), version: 2 },
      ],
    })
    const result = await summarizeLineConversationJobFailures({ businessId: BUSINESS_ID, viewer: viewerFor(BUSINESS_ID), db })

    expect(result.businessId).toBe(BUSINESS_ID)
    expect(result.total).toBe(4)
    expect(result.byErrorCode).toEqual([
      { errorCode: 'LOCAL_POLICY_UNAVAILABLE', count: 3 },
      { errorCode: null, count: 1 },
    ])
    expect(result.failures).toHaveLength(1)

    // Every query is scoped to this Business and to terminal FAILED rows only.
    expect(count.mock.calls[0][0]).toMatchObject({ where: { businessId: BUSINESS_ID, status: 'FAILED' } })
    expect(groupBy.mock.calls[0][0]).toMatchObject({ by: ['errorCode'], where: { businessId: BUSINESS_ID, status: 'FAILED' } })
    const findManyArgs = findMany.mock.calls[0][0]
    expect(findManyArgs.where).toEqual({ businessId: BUSINESS_ID, status: 'FAILED' })
    expect(findManyArgs.orderBy).toEqual({ updatedAt: 'desc' })
    expect(findManyArgs.take).toBe(20)
  })

  it('never selects answer text, reply tokens or LINE recipient/user ids', async () => {
    const { db, findMany } = dbDouble({ total: 1, groups: [], rows: [] })
    await summarizeLineConversationJobFailures({ businessId: BUSINESS_ID, viewer: viewerFor(BUSINESS_ID), db })

    const select = findMany.mock.calls[0][0].select
    expect(select).toEqual({
      id: true, accountId: true, status: true, executionMode: true, modelAccess: true,
      sendMethod: true, attempts: true, errorCode: true, acceptedAt: true,
      createdAt: true, updatedAt: true, version: true,
    })
    for (const forbidden of ['answerText', 'sealedReplyToken', 'recipientId', 'sourceUserId', 'inboundMessageId']) {
      expect(select).not.toHaveProperty(forbidden)
    }
  })
})
