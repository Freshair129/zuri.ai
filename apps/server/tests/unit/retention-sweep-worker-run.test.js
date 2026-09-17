import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatRetentionSweepLogLine, resolveRetentionSweepWorkerConfig, runRetentionSweepOnce } from '../../scripts/retention-sweep-worker-run.mjs'

// @req FR-230 — the testable core of the single-shot retention sweep worker:
//   configuration validation, one authenticated call, and the one JSON line it
//   ever logs. No customer content in any of the three.
// @spec ADR-091 D1, D2
// @tested tests/unit/retention-sweep-worker-run.test.js

const token = 't'.repeat(40)

afterEach(() => vi.unstubAllEnvs())

describe('resolveRetentionSweepWorkerConfig', () => {
  it('throws when the token is missing or under 32 characters', () => {
    expect(() => resolveRetentionSweepWorkerConfig({})).toThrow('ZURI_RETENTION_SWEEP_TOKEN_REQUIRED')
    expect(() => resolveRetentionSweepWorkerConfig({ ZURI_RETENTION_SWEEP_TOKEN: 'short' })).toThrow('ZURI_RETENTION_SWEEP_TOKEN_REQUIRED')
  })

  it('defaults to the loopback endpoint — correct for `docker compose exec` inside the web container', () => {
    const { endpoint, token: resolved } = resolveRetentionSweepWorkerConfig({ ZURI_RETENTION_SWEEP_TOKEN: token })
    expect(endpoint.toString()).toBe('http://127.0.0.1:3000/api/crm/retention-sweep')
    expect(resolved).toBe(token)
  })

  it('accepts an explicit override to the known in-network hostname', () => {
    const { endpoint } = resolveRetentionSweepWorkerConfig({
      ZURI_RETENTION_SWEEP_TOKEN: token, ZURI_RETENTION_SWEEP_URL: 'http://web:3000/api/crm/retention-sweep',
    })
    expect(endpoint.hostname).toBe('web')
  })

  it('accepts https to any host', () => {
    const { endpoint } = resolveRetentionSweepWorkerConfig({
      ZURI_RETENTION_SWEEP_TOKEN: token, ZURI_RETENTION_SWEEP_URL: 'https://example.zuri.internal/api/crm/retention-sweep',
    })
    expect(endpoint.hostname).toBe('example.zuri.internal')
  })

  it('rejects plain HTTP to an arbitrary host, a wrong path, and embedded credentials', () => {
    for (const url of [
      'http://evil.example/api/crm/retention-sweep',
      'http://127.0.0.1:3000/api/crm/wrong-path',
      'http://user:pass@127.0.0.1:3000/api/crm/retention-sweep',
    ]) {
      expect(() => resolveRetentionSweepWorkerConfig({ ZURI_RETENTION_SWEEP_TOKEN: token, ZURI_RETENTION_SWEEP_URL: url }))
        .toThrow('RETENTION_SWEEP_URL_INVALID')
    }
  })
})

describe('runRetentionSweepOnce', () => {
  const endpoint = new URL('http://127.0.0.1:3000/api/crm/retention-sweep')

  it('posts one authenticated request and returns the parsed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ auditEventId: 'a1', countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 2 } } }),
    })
    const result = await runRetentionSweepOnce({ endpoint, token, fetchImpl })
    expect(result).toEqual({
      ok: true, status: 200, body: { auditEventId: 'a1', countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 2 } } },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [calledUrl, options] = fetchImpl.mock.calls[0]
    expect(calledUrl).toBe(endpoint)
    expect(options.method).toBe('POST')
    expect(options.headers.authorization).toBe(`Bearer ${token}`)
    expect(options.redirect).toBe('error')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('reports a wrong-credential response without throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' }) })
    const result = await runRetentionSweepOnce({ endpoint, token, fetchImpl })
    expect(result).toEqual({ ok: false, status: 401, body: { error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' } })
  })

  it('reports an unparseable body as null rather than throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => { throw new SyntaxError('bad json') } })
    const result = await runRetentionSweepOnce({ endpoint, token, fetchImpl })
    expect(result).toEqual({ ok: false, status: 503, body: null })
  })

  it('reports a network failure as UNAVAILABLE rather than throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await runRetentionSweepOnce({ endpoint, token, fetchImpl })
    expect(result).toEqual({ ok: false, status: null, body: null, error: 'UNAVAILABLE' })
  })

  it('reports its own timeout distinctly from a network failure', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const err = new Error('The operation was aborted')
      err.name = 'TimeoutError'
      return Promise.reject(err)
    })
    const result = await runRetentionSweepOnce({ endpoint, token, fetchImpl })
    expect(result).toEqual({ ok: false, status: null, body: null, error: 'TIMEOUT' })
  })
})

describe('formatRetentionSweepLogLine', () => {
  it('produces one JSON line carrying only counts and status — never customer content', () => {
    const line = formatRetentionSweepLogLine({
      ok: true, status: 200, body: { auditEventId: 'a1', countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 4 } }, alreadyRanToday: false },
    })
    expect(JSON.parse(line)).toEqual({
      event: 'crm.retention-sweep.tick', status: 200,
      auditEventId: 'a1', countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 4 } }, alreadyRanToday: false,
    })
  })

  it('carries an error code instead of a body when the call itself failed', () => {
    const line = formatRetentionSweepLogLine({ ok: false, status: null, body: null, error: 'UNAVAILABLE' })
    expect(JSON.parse(line)).toEqual({ event: 'crm.retention-sweep.tick', status: null, error: 'UNAVAILABLE' })
  })

  it('never contains the words a real audit payload would never carry either', () => {
    const line = formatRetentionSweepLogLine({
      ok: true, status: 200, body: { auditEventId: 'a1', countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 1 } } },
    })
    expect(line).not.toMatch(/messageId|conversationId|lineUserId/i)
  })
})
