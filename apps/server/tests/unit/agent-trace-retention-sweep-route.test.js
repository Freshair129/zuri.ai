import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn(), findFirst: vi.fn() }))
vi.mock('@/modules/agent/trace-retention-sweep-service', () => ({
  runAgentTraceRetentionSweep: mocks.run,
  AGENT_TRACE_RETENTION_AUDIT_ACTION: 'AGENT_TRACE_RETENTION_SWEEP_COMPLETED',
  AGENT_TRACE_RETENTION_AUDIT_ENTITY: 'AGENT_TRACE_RETENTION_SWEEP',
}))
vi.mock('@/lib/db', () => ({ default: { auditEvent: { findFirst: mocks.findFirst } } }))

import { POST } from '@/app/api/agent/trace-retention-sweep/route'

// @req FR-230 — Agent's bodyless shared-bearer trace sweep route.
// @spec SEC-001, SEC-031, ADR-091 D2
// @tested tests/unit/agent-trace-retention-sweep-route.test.js

const token = 'a'.repeat(40)
const request = authorization => new Request('http://local/api/agent/trace-retention-sweep', {
  method: 'POST', headers: authorization ? { authorization } : {},
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_RETENTION_SWEEP_TOKEN', token)
  mocks.findFirst.mockResolvedValue(null)
  mocks.run.mockResolvedValue({ auditEventId: 'trace-audit', alreadyRanToday: false,
    countsByClass: { AGENT_TRACE_EVENT: { redactedTurns: 2, redactedEvents: 6 } } })
})
afterEach(() => vi.unstubAllEnvs())

describe('Agent trace retention sweep route', () => {
  it('rejects bad credentials before database or sweep work', async () => {
    for (const authorization of [undefined, 'Bearer short', `Bearer ${'x'.repeat(40)}`]) {
      const response = await POST(request(authorization))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' })
    }
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('guards on the Agent event identity and returns counts only', async () => {
    const response = await POST(request(`Bearer ${token}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ auditEventId: 'trace-audit',
      countsByClass: { AGENT_TRACE_EVENT: { redactedTurns: 2, redactedEvents: 6 } }, alreadyRanToday: false })
    expect(mocks.findFirst.mock.calls[0][0].where).toMatchObject({ entityType: 'AGENT_TRACE_RETENTION_SWEEP',
      action: 'AGENT_TRACE_RETENTION_SWEEP_COMPLETED' })
    expect(mocks.findFirst.mock.calls[0][0].where.entityType).not.toBe('RETENTION_SWEEP')
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })

  it('returns the saved result on a same-day retry and does not run again', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'first-trace-audit', payloadJson: JSON.stringify({
      countsByClass: { AGENT_TRACE_EVENT: { redactedTurns: 4 } },
    }) })
    const response = await POST(request(`Bearer ${token}`))
    expect(await response.json()).toEqual({ auditEventId: 'first-trace-audit',
      countsByClass: { AGENT_TRACE_EVENT: { redactedTurns: 4 } }, alreadyRanToday: true })
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('returns a redacted 503 if its guard or sweep fails', async () => {
    mocks.findFirst.mockRejectedValueOnce(new Error('private database detail'))
    expect((await POST(request(`Bearer ${token}`))).status).toBe(503)
    expect(mocks.run).not.toHaveBeenCalled()
    mocks.findFirst.mockResolvedValue(null)
    mocks.run.mockRejectedValue(new Error('private sweep detail'))
    expect(await (await POST(request(`Bearer ${token}`))).json()).toEqual({ error: 'RETENTION_SWEEP_UNAVAILABLE' })
  })
})
