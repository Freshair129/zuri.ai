import { describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/crm/line-ingest-service', () => ({
  ingestLineMessage: vi.fn(async () => ({ messageId: 'msg-1', conversationId: 'conv-1' })),
}))
vi.mock('@/modules/crm/reply-record-service', () => ({ appendOutbound: vi.fn() }))
vi.mock('@/modules/project-manager/application/audit', () => ({ recordAudit: vi.fn(async () => {}) }))
vi.mock('@/modules/agent/execution-trace', () => ({
  appendTraceEvent: vi.fn(async () => {}),
  readExecutionTrace: vi.fn(),
  playbackTrace: vi.fn(),
  sha256: vi.fn(() => 'hash'),
}))
vi.mock('@/modules/agent/line-execution-trace', () => ({ createLineExecutionTrace: vi.fn() }))

import { admitCapturedLineEvents, admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'

// @req FR-149 — admission runs after LINE has been answered, so its failures have to be handled
//   here rather than by asking for a redelivery that will no longer come; the reply-token deadline
//   it records has to be anchored to LINE's own clock, not to whichever retry happened to compute it.
// @spec ADR-061
// @tested this file

const account = { id: 'account-1', transportEpoch: 1 }
const entry = (id = 'event-1') => ({ event: { webhookEventId: id }, rawRecordId: `raw-${id}` })

function dbDouble({ failUpdate = false } = {}) {
  const update = vi.fn(async () => {
    if (failUpdate) throw new Error('LABEL_WRITE_FAILED')
    return {}
  })
  return { db: { rawExternalRecord: { update } }, update }
}

const label = update => update.mock.calls.map(([call]) => ({
  id: call.where.id,
  status: call.data.processingStatus,
  error: call.data.processingError,
}))

describe('admission after the acknowledgement', () => {
  it('retries a transient failure and records the event as admitted', async () => {
    const { db, update } = dbDouble()
    const admit = vi.fn()
      .mockRejectedValueOnce(new Error('CONNECTION_RESET'))
      .mockResolvedValueOnce({ jobId: 'job-1', created: true })

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [0] })

    expect(admit).toHaveBeenCalledTimes(2)
    expect(outcome).toEqual({ admitted: 1, skipped: 0, failed: 0 })
    expect(label(update)).toEqual([
      { id: 'raw-event-1', status: 'ADMITTING', error: null },
      { id: 'raw-event-1', status: 'ADMITTED', error: null },
    ])
  })

  it('stops retrying a deterministic rejection and marks it skipped', async () => {
    // A 4xx fails the same way every attempt; retrying it only delays the next event.
    const { db, update } = dbDouble()
    const admit = vi.fn().mockRejectedValue(Object.assign(new Error('LINE_TEXT_TOO_LONG'), { status: 400, code: 'LINE_TEXT_TOO_LONG' }))

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [0, 0] })

    expect(admit).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ admitted: 0, skipped: 1, failed: 0 })
    expect(label(update)).toEqual([
      { id: 'raw-event-1', status: 'ADMITTING', error: null },
      { id: 'raw-event-1', status: 'SKIPPED', error: 'LINE_TEXT_TOO_LONG' },
    ])
  })

  it('gives up after the last attempt and leaves the reason on the evidence row', async () => {
    // Nothing will redeliver this event, so the only way it stays findable is the label.
    const { db, update } = dbDouble()
    const admit = vi.fn().mockRejectedValue(new Error('QUEUE_UNAVAILABLE'))

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [0, 0] })

    expect(admit).toHaveBeenCalledTimes(3)
    expect(outcome).toEqual({ admitted: 0, skipped: 0, failed: 1 })
    expect(label(update)).toEqual([
      { id: 'raw-event-1', status: 'ADMITTING', error: null },
      { id: 'raw-event-1', status: 'FAILED', error: 'QUEUE_UNAVAILABLE' },
    ])
  })

  it('marks an event admission chose not to queue as skipped, not failed', async () => {
    const { db, update } = dbDouble()
    const admit = vi.fn(async () => ({ skipped: true }))

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [] })

    expect(outcome).toEqual({ admitted: 0, skipped: 1, failed: 0 })
    expect(label(update)).toEqual([
      { id: 'raw-event-1', status: 'ADMITTING', error: null },
      { id: 'raw-event-1', status: 'SKIPPED', error: null },
    ])
  })

  it('keeps admitting the rest of the batch after one event exhausts its retries', async () => {
    const { db } = dbDouble()
    const admit = vi.fn(async ({ event }) => {
      if (event.webhookEventId === 'event-2') throw new Error('QUEUE_UNAVAILABLE')
      return { jobId: `job-${event.webhookEventId}`, created: true }
    })

    const outcome = await admitCapturedLineEvents({
      account, entries: [entry('event-1'), entry('event-2'), entry('event-3')], db, admit, delays: [0],
    })

    expect(outcome).toEqual({ admitted: 2, skipped: 0, failed: 1 })
    expect(admit.mock.calls.map(([{ event }]) => event.webhookEventId))
      .toEqual(['event-1', 'event-2', 'event-2', 'event-3'])
  })

  it('does not lose a successful admission because the label could not be written', async () => {
    // The evidence row is already durable; the label is an operator convenience, not the record.
    const { db } = dbDouble({ failUpdate: true })
    const admit = vi.fn(async () => ({ jobId: 'job-1', created: true }))

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [] })

    expect(outcome).toEqual({ admitted: 1, skipped: 0, failed: 0 })
  })

  it('passes the reply token through, because admission still owns sealing it', async () => {
    const { db } = dbDouble()
    const admit = vi.fn(async () => ({ jobId: 'job-1', created: true }))
    const event = { webhookEventId: 'event-1', replyToken: 'reply-token-1' }

    await admitCapturedLineEvents({
      account, entries: [{ event, rawRecordId: 'raw-1' }], db, admit, delays: [],
      correlationId: 'corr-1', ingressReceivedAt: new Date('2026-09-10T00:00:00Z'),
    })

    expect(admit).toHaveBeenCalledWith(expect.objectContaining({
      account, event, correlationId: 'corr-1', ingressReceivedAt: new Date('2026-09-10T00:00:00Z'),
    }))
  })
})

// Item 4: the evidence row must say ADMITTING before admission is attempted, once per entry —
// not before each retry — so a crash mid-admission leaves exactly the stranded rows and never a
// superset that swallows the 34 legacy RECEIVED rows that predate this change.
describe('the ADMITTING label precedes the admit attempt', () => {
  it('writes ADMITTING before calling admit, and still lands on ADMITTED', async () => {
    const { db, update } = dbDouble()
    let statusWhenAdmitRan
    const admit = vi.fn(async () => {
      statusWhenAdmitRan = update.mock.calls.at(-1)?.[0]?.data?.processingStatus
      return { jobId: 'job-1', created: true }
    })

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [] })

    expect(statusWhenAdmitRan).toBe('ADMITTING')
    expect(outcome).toEqual({ admitted: 1, skipped: 0, failed: 0 })
    expect(label(update)).toEqual([
      { id: 'raw-event-1', status: 'ADMITTING', error: null },
      { id: 'raw-event-1', status: 'ADMITTED', error: null },
    ])
  })

  it('writes ADMITTING exactly once per entry even when admission retries', async () => {
    const { db, update } = dbDouble()
    const admit = vi.fn()
      .mockRejectedValueOnce(new Error('CONNECTION_RESET'))
      .mockResolvedValueOnce({ jobId: 'job-1', created: true })

    await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [0] })

    expect(label(update).filter(l => l.status === 'ADMITTING')).toHaveLength(1)
  })

  it('still lands on FAILED after the ADMITTING label when every attempt is exhausted', async () => {
    const { db, update } = dbDouble()
    const admit = vi.fn().mockRejectedValue(new Error('QUEUE_UNAVAILABLE'))

    await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [0, 0] })

    expect(label(update).map(l => l.status)).toEqual(['ADMITTING', 'FAILED'])
  })
})

// Item 1: the reply-token deadline is anchored to LINE's own event clock (or, failing that, to
// ingressReceivedAt), never to `now` — because admitLineConversation runs again on each post-ack
// retry (+4s, +12s) with a later `now`, and a retry must not extend a deadline it does not control.
describe('replyExpiresAt is anchored to the event, not to now', () => {
  const SEAL_ENV = { ZURI_LINE_REPLY_SEAL_KEY: 'a7'.repeat(32) }

  const baseEvent = (overrides = {}) => ({
    type: 'message', webhookEventId: 'event-1', replyToken: 'reply-token-1',
    source: { type: 'user', userId: 'user-1' },
    message: { type: 'text', id: 'message-1', text: 'hello' },
    ...overrides,
  })

  function makeAdmissionDb() {
    const oaAccount = {
      id: 'account-1', tenantId: 'tenant-1', businessId: 'business-1', bindingCode: 'bind-1',
      transportEpoch: 1, executionMode: 'SERVER', modelAccess: 'EXTERNAL_MODEL_ALLOWED',
      allowDelayedPush: false, serverEnabled: true, transportMode: 'CLOUD', status: 'CONNECTED',
    }
    const tx = {
      lineOaAccount: { findUnique: vi.fn(async () => oaAccount) },
      lineConversationJob: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }) => ({ id: 'job-1', ...data })),
      },
    }
    const db = { $transaction: vi.fn(async work => work(tx)) }
    return { db, tx }
  }

  const createdReplyExpiresAt = tx => tx.lineConversationJob.create.mock.calls[0][0].data.replyExpiresAt

  it('anchors to ingressReceivedAt, not to a later now (the retry case)', async () => {
    const { db, tx } = makeAdmissionDb()
    const ingressReceivedAt = new Date('2026-09-10T00:00:00.000Z')
    const laterNow = new Date(ingressReceivedAt.getTime() + 16_000) // as if this is the +12s retry

    await admitLineConversation({
      account, event: baseEvent(), now: laterNow, ingressReceivedAt, env: SEAL_ENV, db,
    })

    expect(createdReplyExpiresAt(tx)).toEqual(new Date(ingressReceivedAt.getTime() + 45_000))
  })

  it('records the same deadline no matter how late now is across repeated retries', async () => {
    const ingressReceivedAt = new Date('2026-09-10T00:00:00.000Z')
    const nowValues = [ingressReceivedAt, new Date(ingressReceivedAt.getTime() + 4_000), new Date(ingressReceivedAt.getTime() + 16_000)]
    const deadlines = []
    for (const now of nowValues) {
      const { db, tx } = makeAdmissionDb()
      await admitLineConversation({ account, event: baseEvent(), now, ingressReceivedAt, env: SEAL_ENV, db })
      deadlines.push(createdReplyExpiresAt(tx).getTime())
    }

    expect(new Set(deadlines).size).toBe(1)
    expect(deadlines[0]).toBe(ingressReceivedAt.getTime() + 45_000)
  })

  it('anchors to event.timestamp when LINE issued it before ingressReceivedAt', async () => {
    const { db, tx } = makeAdmissionDb()
    const eventTimestampMs = Date.parse('2026-09-10T00:00:00.000Z')
    const ingressReceivedAt = new Date(eventTimestampMs + 5_000) // ingest ran 5s after LINE's own clock

    await admitLineConversation({
      account, event: baseEvent({ timestamp: eventTimestampMs }), now: ingressReceivedAt, ingressReceivedAt, env: SEAL_ENV, db,
    })

    expect(createdReplyExpiresAt(tx)).toEqual(new Date(eventTimestampMs + 45_000))
  })

  it('clamps a future-skewed event.timestamp to ingressReceivedAt rather than extending the deadline', async () => {
    const { db, tx } = makeAdmissionDb()
    const ingressReceivedAt = new Date('2026-09-10T00:00:00.000Z')
    const futureTimestampMs = ingressReceivedAt.getTime() + 60_000 // hostile/skewed clock, in the future

    await admitLineConversation({
      account, event: baseEvent({ timestamp: futureTimestampMs }), now: ingressReceivedAt, ingressReceivedAt, env: SEAL_ENV, db,
    })

    expect(createdReplyExpiresAt(tx)).toEqual(new Date(ingressReceivedAt.getTime() + 45_000))
  })

  it('falls back to ingressReceivedAt when event.timestamp is missing or unusable', async () => {
    const { db, tx } = makeAdmissionDb()
    const ingressReceivedAt = new Date('2026-09-10T00:00:00.000Z')

    await admitLineConversation({
      account, event: baseEvent({ timestamp: 'not-a-number' }), now: ingressReceivedAt, ingressReceivedAt, env: SEAL_ENV, db,
    })

    expect(createdReplyExpiresAt(tx)).toEqual(new Date(ingressReceivedAt.getTime() + 45_000))
  })
})
