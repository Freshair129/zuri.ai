import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn(), findFirst: vi.fn() }))
vi.mock('@/platform/integrations/core/raw-line-retention-sweep-service', () => ({
  runRawLineRetentionSweep: mocks.run,
  RAW_LINE_RETENTION_AUDIT_ACTION: 'RAW_LINE_RETENTION_SWEEP_COMPLETED',
  RAW_LINE_RETENTION_AUDIT_ENTITY: 'INTEGRATION_RAW_LINE_RETENTION_SWEEP',
}))
vi.mock('@/lib/db', () => ({ default: { auditEvent: { findFirst: mocks.findFirst } } }))

import { POST } from '@/app/api/integration/raw-retention-sweep/route'

// @req FR-230 — Integration's bodyless shared-bearer sweep route.
// @spec SEC-001, SEC-031, ADR-091 D2
// @tested tests/unit/raw-line-retention-sweep-route.test.js

const token = 'r'.repeat(40)
const request = authorization => new Request('http://local/api/integration/raw-retention-sweep', {
  method: 'POST', headers: authorization ? { authorization } : {},
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_RETENTION_SWEEP_TOKEN', token)
  mocks.findFirst.mockResolvedValue(null)
  mocks.run.mockResolvedValue({ auditEventId: 'raw-audit', alreadyRanToday: false,
    countsByClass: { RAW_LINE_PAYLOAD: { redactedRawRecords: 2, skippedNonTerminalJob: 1 } } })
})
afterEach(() => vi.unstubAllEnvs())

describe('Integration raw retention sweep route', () => {
  it('rejects missing and incorrect credentials before database or sweep work', async () => {
    for (const authorization of [undefined, 'Bearer short', `Bearer ${'x'.repeat(40)}`]) {
      const response = await POST(request(authorization))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' })
    }
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('uses the Integration event identity for the same-day guard and returns counts only', async () => {
    const response = await POST(request(`Bearer ${token}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ auditEventId: 'raw-audit',
      countsByClass: { RAW_LINE_PAYLOAD: { redactedRawRecords: 2, skippedNonTerminalJob: 1 } }, alreadyRanToday: false })
    expect(mocks.findFirst.mock.calls[0][0].where).toMatchObject({ entityType: 'INTEGRATION_RAW_LINE_RETENTION_SWEEP',
      action: 'RAW_LINE_RETENTION_SWEEP_COMPLETED' })
    expect(mocks.findFirst.mock.calls[0][0].where.entityType).not.toBe('RETENTION_SWEEP')
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })

  it('returns the first run result during the same UTC day without rerunning', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'first-audit', payloadJson: JSON.stringify({
      countsByClass: { RAW_LINE_PAYLOAD: { redactedRawRecords: 8 } },
    }) })
    const response = await POST(request(`Bearer ${token}`))
    expect(await response.json()).toEqual({ auditEventId: 'first-audit',
      countsByClass: { RAW_LINE_PAYLOAD: { redactedRawRecords: 8 } }, alreadyRanToday: true })
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('fails closed if the same-day lookup or sweep fails', async () => {
    mocks.findFirst.mockRejectedValueOnce(new Error('db unavailable'))
    expect((await POST(request(`Bearer ${token}`))).status).toBe(503)
    expect(mocks.run).not.toHaveBeenCalled()
    mocks.findFirst.mockResolvedValue(null)
    mocks.run.mockRejectedValue(new Error('private detail'))
    expect(await (await POST(request(`Bearer ${token}`))).json()).toEqual({ error: 'RETENTION_SWEEP_UNAVAILABLE' })
  })
})
