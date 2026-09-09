import { describe, expect, it, vi } from 'vitest'
import { admitCapturedLineEvents } from '@/modules/line-oa-studio/application/line-conversation-jobs'

// @req FR-149 — admission runs after LINE has been answered, so its failures have to be handled
//   here rather than by asking for a redelivery that will no longer come.
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
    expect(label(update)).toEqual([{ id: 'raw-event-1', status: 'ADMITTED', error: null }])
  })

  it('stops retrying a deterministic rejection and marks it skipped', async () => {
    // A 4xx fails the same way every attempt; retrying it only delays the next event.
    const { db, update } = dbDouble()
    const admit = vi.fn().mockRejectedValue(Object.assign(new Error('LINE_TEXT_TOO_LONG'), { status: 400, code: 'LINE_TEXT_TOO_LONG' }))

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [0, 0] })

    expect(admit).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ admitted: 0, skipped: 1, failed: 0 })
    expect(label(update)).toEqual([{ id: 'raw-event-1', status: 'SKIPPED', error: 'LINE_TEXT_TOO_LONG' }])
  })

  it('gives up after the last attempt and leaves the reason on the evidence row', async () => {
    // Nothing will redeliver this event, so the only way it stays findable is the label.
    const { db, update } = dbDouble()
    const admit = vi.fn().mockRejectedValue(new Error('QUEUE_UNAVAILABLE'))

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [0, 0] })

    expect(admit).toHaveBeenCalledTimes(3)
    expect(outcome).toEqual({ admitted: 0, skipped: 0, failed: 1 })
    expect(label(update)).toEqual([{ id: 'raw-event-1', status: 'FAILED', error: 'QUEUE_UNAVAILABLE' }])
  })

  it('marks an event admission chose not to queue as skipped, not failed', async () => {
    const { db, update } = dbDouble()
    const admit = vi.fn(async () => ({ skipped: true }))

    const outcome = await admitCapturedLineEvents({ account, entries: [entry()], db, admit, delays: [] })

    expect(outcome).toEqual({ admitted: 0, skipped: 1, failed: 0 })
    expect(label(update)).toEqual([{ id: 'raw-event-1', status: 'SKIPPED', error: null }])
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
