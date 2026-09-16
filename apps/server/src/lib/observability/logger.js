// @req FR-247 — exception(): fingerprints and parses an error for a caller to
//   persist. `src/lib` stays free of a database dependency by existing
//   convention (no sibling file here imports `@/lib/db`), so this returns a
//   shape rather than writing one — `recordErrorEvent()` in
//   `platform-control/application/error-events.js` is the caller that persists it.
// @spec NFR-017, SDD-048 — one structured emitter with an allowlisted field set.
// @spec SEC-009 — secrets, PII and raw provider payloads never reach a log line.
// @spec ADR-095 D1
// @tested tests/unit/observability-logger.test.js
import { createHash } from 'node:crypto'
//
// WHY AN ALLOWLIST
// ----------------
// The obvious design is a denylist: strip `authorization`, `replyToken`, `text`… That
// only ever knows the secrets someone already thought of, and the failure mode is
// silent — a new field carrying a customer's message body logs cleanly and nobody
// notices until it is in a log aggregator. Here the emitter accepts a fixed set of
// names and drops everything else, so adding a field is a deliberate act. A dropped
// field is reported by NAME (never by value) in `unsafeFieldsOmitted`, because a guard
// that quietly discards data is how you end up debugging a log line that isn't there.

/**
 * Field names any record may carry. Ids, codes, counts, durations, states — the
 * vocabulary of "what happened", never "what was said".
 *
 * Deliberately absent, and the reason each stays absent:
 *   text / body / message      the customer's own words (PII, SEC-009)
 *   displayName                the customer's name (PII)
 *   authorization / bearer     the binding credential
 *   bindingId                  binding identity is a credential input (FR-052)
 *   replyToken                 transient LINE credential (BR-011)
 *   payload / event            the raw provider payload (evidence, not a log line)
 */
export const ALLOWED_FIELDS = Object.freeze([
  // correlation
  'correlationId', 'eventId', 'requestId',
  // scope — ids only; these are opaque UUIDs, not personal data
  'tenantId', 'businessId', 'connectionId', 'conversationId', 'messageId', 'personId',
  // what happened
  'stage', 'outcome', 'errorCode', 'eventType', 'messageType', 'skipped', 'skipReply',
  'evidenceStatus', 'principalType', 'responseKind', 'grounded',
  // shape and cost
  'received', 'handled', 'failed', 'skippedCount', 'evidenceRecorded', 'durationMs',
  // provenance of the correlation id itself
  'correlationSource',
])

const ALLOWED = new Set(ALLOWED_FIELDS)
const LEVELS = new Set(['debug', 'info', 'warn', 'error'])

// @req FR-247 — a V8 stack frame is a call site, never a variable value: unlike
// some other languages' traces, `Error.stack` here carries no local state, so
// parsing it into `{file, line, function}` is a formatting step, not a redaction
// one. A line that does not match this shape (a library that appends something
// else) is dropped rather than stored as free text — the same allowlist
// discipline as the rest of this file, applied to one more input.
const STACK_FRAME = /^\s*at\s+(?:(.+?)\s+\()?([^()\s][^()]*?):(\d+):(\d+)\)?\s*$/
const MAX_FRAMES = 10

/** Parse `error.stack` into safe `{file, line, function}` frames. Never throws. */
export function parseStackFrames(stack) {
  if (typeof stack !== 'string') return []
  const frames = []
  for (const line of stack.split('\n')) {
    const m = STACK_FRAME.exec(line)
    if (!m) continue
    frames.push({ function: m[1] || null, file: m[2], line: Number(m[3]) })
    if (frames.length >= MAX_FRAMES) break
  }
  return frames
}

/**
 * The identity of a recurring defect: same name, same message, same first call
 * site. Two errors that differ only in, say, a request id are still one defect —
 * fingerprinting on the message would treat every occurrence as new.
 */
export function computeErrorFingerprint({ name, message, frames }) {
  const first = frames?.[0] ? `${frames[0].file}:${frames[0].line}` : ''
  return createHash('sha256').update(`${name || ''}:${message || ''}:${first}`).digest('hex')
}

function partitionFields(fields) {
  const safe = {}
  const omitted = []
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value === undefined) continue
    if (ALLOWED.has(key)) safe[key] = value
    else omitted.push(key)
  }
  return { safe, omitted }
}

/** stdout, one JSON object per line — the format every log shipper already reads. */
const defaultSink = (record) => {
  // eslint-disable-next-line no-console -- the process boundary this module exists to own
  console.log(JSON.stringify(record))
}

/**
 * Build an emitter.
 *
 * @param {object}   [options]
 * @param {Function} [options.sink]   receives the finished record; defaults to stdout
 * @param {Function} [options.clock]  () => Date, injectable so records are assertable
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function, emit: Function }}
 */
export function createLogger({ sink = defaultSink, clock = () => new Date() } = {}) {
  function emit(level, event, fields) {
    if (!LEVELS.has(level)) throw new Error(`LOG_LEVEL_INVALID: ${level}`)
    if (typeof event !== 'string' || !event.trim()) throw new Error('LOG_EVENT_REQUIRED')

    const { safe, omitted } = partitionFields(fields)
    const record = { ts: clock().toISOString(), level, event, ...safe }
    if (omitted.length) record.unsafeFieldsOmitted = omitted.sort()

    try {
      sink(record)
    } catch {
      // Observability must never take down the request it is describing. A sink that
      // throws (closed stdout, a broken shipper) is swallowed here and nowhere else.
    }
    return record
  }

  // @req FR-247 — parse, fingerprint and emit; never persist. `record` here is the
  // stdout line (unchanged shape from `error()`); `fingerprint`/`name`/`message`/
  // `frames` is what a caller hands to `recordErrorEvent(db, ...)` to persist one
  // ErrorEvent row. A caller that only wants the stdout line and not persistence
  // is free to ignore everything but `record`.
  function exception(event, error, fields) {
    const name = error?.name || 'Error'
    const message = error?.message || ''
    const frames = parseStackFrames(error?.stack)
    const record = emit('error', event, fields)
    return { record, fingerprint: computeErrorFingerprint({ name, message, frames }), name, message, frames }
  }

  return {
    emit,
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    exception,
  }
}

/** The process-wide emitter. Routes take an injectable one; this is the default. */
export const logger = createLogger()
