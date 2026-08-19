import { randomUUID } from 'node:crypto'

// @spec NFR-017, SDD-048 — one correlation id per inbound batch, spanning both runtimes.
// @spec SEC-002 — the id arrives as untrusted input and is echoed into records and
//   responses, so its shape is validated before it is ever used.
// @tested tests/unit/observability-correlation.test.js

export const CORRELATION_HEADER = 'x-correlation-id'

// Deliberately narrow. The id is echoed into JSON log records and the HTTP response,
// so it must not be able to carry newlines (log forging), control characters, or an
// unbounded string. Long enough to hold a UUID, short enough to bound the field.
const VALID = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Resolve the correlation id for one request.
 *
 * The transport owner (zuri-cli) holds the LINE side of the chain, so when it presents
 * a well-formed id we adopt it — that is the only way one identifier spans both
 * runtimes. Anything malformed is replaced rather than rejected: a bad header is not a
 * reason to drop a customer's message, but it must not silently look like the caller's
 * id either, which is what `source` records.
 *
 * @param {Headers|object|null} headers
 * @returns {{ correlationId: string, source: 'CALLER'|'GENERATED'|'REPLACED_INVALID' }}
 */
export function resolveCorrelationId(headers, { generate = randomUUID } = {}) {
  const raw = readHeader(headers, CORRELATION_HEADER)
  if (raw === null || raw === undefined || raw === '') {
    return { correlationId: generate(), source: 'GENERATED' }
  }
  if (!VALID.test(String(raw))) {
    return { correlationId: generate(), source: 'REPLACED_INVALID' }
  }
  return { correlationId: String(raw), source: 'CALLER' }
}

function readHeader(headers, name) {
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name)
  return headers[name] ?? headers[name.toLowerCase()] ?? null
}
