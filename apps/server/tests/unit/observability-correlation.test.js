import { describe, it, expect } from 'vitest'
import { resolveCorrelationId, CORRELATION_HEADER } from '@/lib/observability/correlation'

// @spec NFR-017, SDD-048 — one correlation id per batch, spanning both runtimes.
// @spec SEC-002 — the header is untrusted input and is echoed into records and the
//   HTTP response, so its shape is validated before it is used.

const generate = () => 'generated-0000-0000'
const withHeader = (value) => new Headers(value === undefined ? {} : { [CORRELATION_HEADER]: value })

describe('resolveCorrelationId (NFR-017)', () => {
  it('adopts a well-formed id from the transport owner so the chain spans both runtimes', () => {
    expect(resolveCorrelationId(withHeader('zuri-cli-01JABCDE'), { generate })).toEqual({
      correlationId: 'zuri-cli-01JABCDE',
      source: 'CALLER',
    })
  })

  it('generates one when the caller sends none', () => {
    expect(resolveCorrelationId(withHeader(undefined), { generate })).toEqual({
      correlationId: 'generated-0000-0000',
      source: 'GENERATED',
    })
    expect(resolveCorrelationId(null, { generate }).source).toBe('GENERATED')
  })

  it('replaces a malformed id instead of dropping the customer message', () => {
    // a bad header is not a reason to refuse a LINE event — but it must not be able to
    // masquerade as the caller's id either, which is what `source` records
    for (const bad of ['short', 'x'.repeat(65), 'has spaces', 'semi;colon']) {
      const resolved = resolveCorrelationId(withHeader(bad), { generate })
      expect(resolved).toEqual({ correlationId: 'generated-0000-0000', source: 'REPLACED_INVALID' })
    }
  })

  it('refuses an id that could forge a log line', () => {
    // The id lands inside a JSON record and an HTTP response, so a newline or control
    // character would let a caller inject a fabricated record downstream.
    //
    // These use the plain-object path on purpose: the platform `Headers` class already
    // throws on CRLF, so a real request cannot carry the first two at all. That is the
    // outer guard — this asserts the inner one, which is what still applies when the id
    // reaches us from a header bag that did no validating of its own.
    const LF = String.fromCharCode(10)
    const CR = String.fromCharCode(13)
    const NUL = String.fromCharCode(0)

    for (const hostile of [
      `abcdefgh${LF}{"level":"info","event":"fake"}`,
      `abcdefgh${CR}${LF}X-Injected: 1`,
      `abcdefgh${NUL}null`,
      '{"$ne":null}',
      '../../etc/passwd',
      'abcdefgh","level":"error"',
    ]) {
      expect(resolveCorrelationId({ [CORRELATION_HEADER]: hostile }, { generate }).source)
        .toBe('REPLACED_INVALID')
    }
  })

  it('accepts a plain UUID, which is what the generator produces', () => {
    const uuid = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
    expect(resolveCorrelationId(withHeader(uuid), { generate })).toEqual({
      correlationId: uuid,
      source: 'CALLER',
    })
  })

  it('reads a plain object as well as a Headers instance', () => {
    expect(resolveCorrelationId({ [CORRELATION_HEADER]: 'plain-object-id' }, { generate }).source)
      .toBe('CALLER')
  })
})
