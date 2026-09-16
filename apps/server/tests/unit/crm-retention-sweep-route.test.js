import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @req FR-230 — the deployment-authenticated route that gives the FR-230 sweep an
//   actual, callable, scheduled entry point: bearer checked before any work, a
//   successful call returns the sweep's own per-class counts, and a second call
//   inside the same UTC day answers from the existing audit event instead of
//   running (or auditing) the sweep a second time.
// @spec ADR-091 D1, D2; SEC-001
// @tested tests/unit/crm-retention-sweep-route.test.js
const mocks = vi.hoisted(() => ({
  runRetentionSweep: vi.fn(),
  findFirst: vi.fn(),
}))
vi.mock('@/modules/crm/retention-sweep-service', () => ({ runRetentionSweep: mocks.runRetentionSweep }))
vi.mock('@/lib/db', () => ({ default: { auditEvent: { findFirst: mocks.findFirst } } }))

import { POST as sweepPost } from '@/app/api/crm/retention-sweep/route'

const token = 'r'.repeat(40)
const request = (authorization) => new Request('http://local/api/crm/retention-sweep', {
  method: 'POST', headers: authorization ? { authorization } : {},
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_RETENTION_SWEEP_TOKEN', token)
  mocks.findFirst.mockResolvedValue(null)
  mocks.runRetentionSweep.mockResolvedValue({
    auditEventId: 'audit-1',
    countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 3, redactedAttachments: 1, skippedNonTerminalJob: 0 } },
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('deployment-authenticated retention sweep route', () => {
  it('rejects missing, short and same-length incorrect bearers before touching the sweep or the db', async () => {
    for (const bearer of [undefined, 'Bearer short', `Bearer ${'x'.repeat(40)}`]) {
      const response = await sweepPost(request(bearer))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' })
    }
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.runRetentionSweep).not.toHaveBeenCalled()
  })

  it('rejects every bearer when the configured token itself is short or unset — never a partial sweep', async () => {
    vi.stubEnv('ZURI_RETENTION_SWEEP_TOKEN', 'short')
    expect((await sweepPost(request('Bearer short'))).status).toBe(401)
    vi.stubEnv('ZURI_RETENTION_SWEEP_TOKEN', '')
    expect((await sweepPost(request('Bearer '))).status).toBe(401)
    expect(mocks.runRetentionSweep).not.toHaveBeenCalled()
  })

  it('runs the sweep on a matching bearer and returns exactly the counts the sweep itself reports', async () => {
    const response = await sweepPost(request(`Bearer ${token}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      auditEventId: 'audit-1',
      countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 3, redactedAttachments: 1, skippedNonTerminalJob: 0 } },
      alreadyRanToday: false,
    })
    // No customer content, no message text, nothing beyond the pinned shape above.
    expect(Object.keys(body).sort()).toEqual(['alreadyRanToday', 'auditEventId', 'countsByClass'])
    expect(mocks.runRetentionSweep).toHaveBeenCalledTimes(1)
    const call = mocks.runRetentionSweep.mock.calls[0][0]
    expect(call.now).toBeInstanceOf(Date)
  })

  it('checks for an existing same-UTC-day audit event before running the sweep', async () => {
    await sweepPost(request(`Bearer ${token}`))
    expect(mocks.findFirst).toHaveBeenCalledTimes(1)
    const [args] = mocks.findFirst.mock.calls
    expect(args[0].where.entityType).toBe('RETENTION_SWEEP')
    expect(args[0].where.action).toBe('RETENTION_SWEEP_COMPLETED')
    expect(args[0].where.occurredAt.gte).toBeInstanceOf(Date)
    expect(args[0].where.occurredAt.lt).toBeInstanceOf(Date)
    // A UTC-day window: exactly 24h wide.
    expect(args[0].where.occurredAt.lt.getTime() - args[0].where.occurredAt.gte.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('is idempotent-safe for a scheduler retry inside the same day: answers from the existing audit event and never re-runs or re-audits the sweep', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'audit-1',
      payloadJson: JSON.stringify({
        ranAt: '2026-09-14T20:00:00.000Z',
        countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 5, redactedAttachments: 2, skippedNonTerminalJob: 1 } },
      }),
    })
    const response = await sweepPost(request(`Bearer ${token}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      auditEventId: 'audit-1',
      countsByClass: { MESSAGE_BODY_AND_ATTACHMENTS: { redactedMessages: 5, redactedAttachments: 2, skippedNonTerminalJob: 1 } },
      alreadyRanToday: true,
    })
    expect(mocks.runRetentionSweep).not.toHaveBeenCalled()
  })

  it('answers 503 and redacts the failure when the sweep throws — a failure must never leak internal detail', async () => {
    mocks.runRetentionSweep.mockRejectedValue(new Error('PRIVATE_DATABASE_URL_LEAK'))
    const response = await sweepPost(request(`Bearer ${token}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'RETENTION_SWEEP_UNAVAILABLE' })
  })

  it('answers 503 when the same-day lookup itself fails, rather than running an unguarded sweep', async () => {
    mocks.findFirst.mockRejectedValue(new Error('DB_UNAVAILABLE'))
    const response = await sweepPost(request(`Bearer ${token}`))
    expect(response.status).toBe(503)
    expect(mocks.runRetentionSweep).not.toHaveBeenCalled()
  })
})
