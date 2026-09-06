// @spec NFR-017, SDD-048 — one structured emitter with an allowlisted field set.
// @spec SEC-009 — secrets, PII and raw provider payloads never reach a log line.
// @tested tests/unit/observability-logger.test.js
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

  return {
    emit,
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  }
}

/** The process-wide emitter. Routes take an injectable one; this is the default. */
export const logger = createLogger()
