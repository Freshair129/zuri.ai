import { describe, it, expect } from 'vitest'
import { createLogger, ALLOWED_FIELDS, parseStackFrames, computeErrorFingerprint } from '@/lib/observability/logger'

// @spec NFR-017, SDD-048 — one emitter, allowlisted fields, nothing silent.
// @spec SEC-009 — secrets, PII and raw provider payloads never reach a log line.
// @req FR-247 — exception(): fingerprint and parse for a caller to persist.
// @spec ADR-095 D1

function capture() {
  const records = []
  const logger = createLogger({
    sink: (record) => records.push(record),
    clock: () => new Date('2026-08-19T00:00:00.000Z'),
  })
  return { logger, records }
}

describe('structured emitter (SDD-048)', () => {
  it('emits one record with a timestamp, level and event name', () => {
    const { logger, records } = capture()
    logger.info('line.webhook.received', { correlationId: 'abcd1234', received: 2 })

    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({
      ts: '2026-08-19T00:00:00.000Z',
      level: 'info',
      event: 'line.webhook.received',
      correlationId: 'abcd1234',
      received: 2,
    })
  })

  it('drops a field the allowlist does not know, and names it', () => {
    const { logger, records } = capture()
    const record = logger.info('line.webhook.event', {
      correlationId: 'abcd1234',
      somethingNew: 'value that must not be printed',
    })

    expect(record.somethingNew).toBeUndefined()
    expect(record.unsafeFieldsOmitted).toEqual(['somethingNew'])
    // the NAME is reported so a dropped field is visible; the VALUE never is
    expect(JSON.stringify(record)).not.toContain('value that must not be printed')
  })

  it('refuses the specific fields that would leak a customer or a credential', () => {
    const { logger } = capture()
    const record = logger.info('line.webhook.event', {
      correlationId: 'abcd1234',
      text: 'ลูกค้าอยากได้ราคาพิเศษ',
      body: 'same message, other name',
      message: 'and again',
      displayName: 'คุณมานะ',
      authorization: 'Bearer super-secret-binding-token',
      bearer: 'super-secret-binding-token',
      bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
      replyToken: 'transient-line-reply-token',
      payload: { event: { message: { text: 'raw provider payload' } } },
      event: 'shadowing attempt',
    })

    const serialized = JSON.stringify(record)
    for (const secret of [
      'ลูกค้าอยากได้ราคาพิเศษ', 'same message, other name', 'and again', 'คุณมานะ',
      'super-secret-binding-token', '84ed2c90-ab44-46f3-9618-1f24df0744b9',
      'transient-line-reply-token', 'raw provider payload',
    ]) {
      expect(serialized).not.toContain(secret)
    }
    // `event` is a reserved record field, not a caller-supplied one: the caller's value
    // must not be able to overwrite the event name
    expect(record.event).toBe('line.webhook.event')
  })

  it('keeps identifiers, counts and outcomes — the vocabulary of what happened', () => {
    const { logger } = capture()
    const record = logger.info('line.webhook.event', {
      correlationId: 'abcd1234', eventId: 'WEH-1', tenantId: 't1', businessId: 'b1',
      conversationId: 'c1', messageId: 'm1', personId: 'p1', connectionId: 'conn1',
      stage: 'TURN', outcome: 'OK', responseKind: 'ANSWER', durationMs: 12,
    })
    expect(record.unsafeFieldsOmitted).toBeUndefined()
    expect(record).toMatchObject({ conversationId: 'c1', messageId: 'm1', durationMs: 12 })
  })

  it('omits undefined so an absent value never becomes a null column', () => {
    const { logger } = capture()
    const record = logger.info('e', { correlationId: 'abcd1234', businessId: undefined })
    expect('businessId' in record).toBe(false)
    expect(record.unsafeFieldsOmitted).toBeUndefined()
  })

  it('never lets a broken sink take down the request it is describing', () => {
    const logger = createLogger({ sink: () => { throw new Error('stdout closed') } })
    expect(() => logger.error('line.webhook.event', { correlationId: 'abcd1234' })).not.toThrow()
  })

  it('rejects a malformed call rather than emitting a shapeless record', () => {
    const { logger } = capture()
    expect(() => logger.emit('trace', 'e', {})).toThrow(/LOG_LEVEL_INVALID/)
    expect(() => logger.emit('info', '', {})).toThrow(/LOG_EVENT_REQUIRED/)
  })

  it('keeps the allowlist free of anything that reads as content', () => {
    // a guard on the guard: if someone adds a field here, this is where they notice
    for (const banned of ['text', 'body', 'message', 'displayName', 'authorization',
      'bearer', 'bindingId', 'replyToken', 'payload', 'destination', 'lineUserId']) {
      expect(ALLOWED_FIELDS).not.toContain(banned)
    }
  })
})

describe('FR-247 exception(): fingerprint and parse, never persist', () => {
  function realError(name, message) {
    // A real thrown error has V8's own stack shape — building one by hand
    // (rather than typing a fixture string) is what proves the parser matches
    // what Node actually produces, not what this test imagines it produces.
    try {
      const err = new Error(message)
      err.name = name
      throw err
    } catch (err) {
      return err
    }
  }

  it('parses a real V8 stack into file:line:function frames, dropping anything else', () => {
    const error = realError('Error', 'QUEUE_UNAVAILABLE')
    const frames = parseStackFrames(error.stack)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames[0]).toMatchObject({ file: expect.stringContaining('observability-logger.test.js'), line: expect.any(Number) })
    // no frame carries anything other than function/file/line — no message text leaks through
    for (const frame of frames) expect(Object.keys(frame).sort()).toEqual(['file', 'function', 'line'])
  })

  it('drops a line that is not a file:line call-site shape', () => {
    const stack = 'Error: SOME_CODE\n    at realFrame (file.js:10:5)\n    <anonymous>\n    a plain text line, not a frame'
    const frames = parseStackFrames(stack)
    expect(frames).toEqual([{ function: 'realFrame', file: 'file.js', line: 10 }])
  })

  it('returns no frames for a non-string stack rather than throwing', () => {
    expect(parseStackFrames(undefined)).toEqual([])
    expect(parseStackFrames(null)).toEqual([])
  })

  it('fingerprints on name, message and the first frame only — not the whole stack', () => {
    const a = computeErrorFingerprint({ name: 'Error', message: 'QUEUE_UNAVAILABLE', frames: [{ file: 'x.js', line: 10 }, { file: 'y.js', line: 99 }] })
    const b = computeErrorFingerprint({ name: 'Error', message: 'QUEUE_UNAVAILABLE', frames: [{ file: 'x.js', line: 10 }, { file: 'DIFFERENT.js', line: 1 }] })
    expect(a).toBe(b)
    const c = computeErrorFingerprint({ name: 'Error', message: 'QUEUE_UNAVAILABLE', frames: [{ file: 'DIFFERENT.js', line: 10 }] })
    expect(a).not.toBe(c)
  })

  it('emits exactly as error() does — same allowlist, same stdout shape', () => {
    const { logger, records } = capture()
    const { record } = logger.exception('line.webhook.failed', realError('Error', 'QUEUE_UNAVAILABLE'), { correlationId: 'abcd1234', errorCode: 'QUEUE_UNAVAILABLE' })
    expect(records).toHaveLength(1)
    expect(record).toEqual({ ts: '2026-08-19T00:00:00.000Z', level: 'error', event: 'line.webhook.failed', correlationId: 'abcd1234', errorCode: 'QUEUE_UNAVAILABLE' })
    // `name`/`message`/`stack` are not in ALLOWED_FIELDS — only the caller-supplied
    // `errorCode` (which happens to say the same thing) reaches stdout
    expect(record.name).toBeUndefined()
    expect(record.message).toBeUndefined()
    expect('stack' in record).toBe(false)
  })

  it('returns a fingerprint and parsed shape a caller can persist, without writing anything itself', () => {
    const { logger } = capture()
    const first = logger.exception('e', realError('TypeError', 'BAD_INPUT'))
    const second = logger.exception('e', realError('TypeError', 'BAD_INPUT'))
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.name).toBe('TypeError')
    expect(first.message).toBe('BAD_INPUT')
    expect(Array.isArray(first.frames)).toBe(true)
  })
})
