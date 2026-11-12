import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @req FR-245, SEC-034 — the daily deployment trigger for format-4 archive
//   retirement; bearer validation precedes work, and HTTP responses contain
//   aggregate counts only (ADR-093 D5 P7).
// @spec ADR-093 D5 (1.3.0), SDD-103, SEC-001
// @tested tests/unit/crm-archive-expiry-route.test.js
const mocks = vi.hoisted(() => ({ run: vi.fn(), findFirst: vi.fn() }))
vi.mock('@/modules/crm/chat-evidence-archive-expiry-run-service', () => ({ runChatEvidenceArchiveExpiry: mocks.run }))
vi.mock('@/lib/db', () => ({ default: { auditEvent: { findFirst: mocks.findFirst } } }))

import { POST } from '@/app/api/crm/archive-expiry/route'

const token = 'e'.repeat(40)
const request = (authorization) => new Request('http://local/api/crm/archive-expiry', {
  method: 'POST', headers: authorization ? { authorization } : {},
})
const counts = {
  tenantsVisited: 3,
  keysDestroyed: 2,
  holdKeysDestroyed: 1,
  manifestsRetired: 2,
  filesDeleted: 2,
  retiredFilesStillPresent: 0,
  skipped: 0,
  failures: 0,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_RETENTION_SWEEP_TOKEN', token)
  mocks.findFirst.mockResolvedValue(null)
  mocks.run.mockResolvedValue({ auditEventId: 'private-audit-id', counts })
})
afterEach(() => vi.unstubAllEnvs())

describe('deployment-authenticated CRM archive expiry route', () => {
  it('rejects invalid credentials before database or archive work and never reads the body', async () => {
    for (const bearer of [undefined, 'Bearer short', `Bearer ${'x'.repeat(40)}`]) {
      const req = request(bearer)
      req.json = vi.fn(() => { throw new Error('BODY_READ') })
      const response = await POST(req)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'RETENTION_SWEEP_CREDENTIAL_REQUIRED' })
      expect(req.json).not.toHaveBeenCalled()
    }
    expect(mocks.findFirst).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('runs under the bearer and returns only aggregate counts', async () => {
    const response = await POST(request(`Bearer ${token}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ counts, alreadyRanToday: false })
    expect(JSON.stringify(body)).not.toMatch(/customer|filePath|private-audit-id/i)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.run.mock.calls[0][1].now).toBeInstanceOf(Date)
  })

  it('guards on the run-level audit identity inside one UTC day', async () => {
    await POST(request(`Bearer ${token}`))
    const [args] = mocks.findFirst.mock.calls[0]
    expect(args.where).toMatchObject({ entityType: 'ARCHIVE_EXPIRY_RUN', action: 'ARCHIVE_EXPIRY_RUN_COMPLETED' })
    expect(args.where.occurredAt.gte).toBeInstanceOf(Date)
    expect(args.where.occurredAt.lt.getTime() - args.where.occurredAt.gte.getTime()).toBe(24 * 60 * 60 * 1000)

    mocks.findFirst.mockResolvedValue({ payloadJson: JSON.stringify({ counts }) })
    const retry = await POST(request(`Bearer ${token}`))
    expect(await retry.json()).toEqual({ counts, alreadyRanToday: true })
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })

  it('answers 503 on storage refusal or a run-level failure', async () => {
    mocks.run.mockRejectedValueOnce(Object.assign(new Error('private storage detail'), { code: 'ARCHIVE_STORAGE_REQUIRED' }))
    const response = await POST(request(`Bearer ${token}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'ARCHIVE_EXPIRY_UNAVAILABLE' })

    mocks.run.mockRejectedValueOnce(new Error('private run failure'))
    const failure = await POST(request(`Bearer ${token}`))
    expect(failure.status).toBe(503)
    expect(await failure.json()).toEqual({ error: 'ARCHIVE_EXPIRY_UNAVAILABLE' })
  })

  it('answers 503 when the same-day guard cannot be checked', async () => {
    mocks.findFirst.mockRejectedValue(new Error('PRIVATE_DATABASE_FAILURE'))
    const response = await POST(request(`Bearer ${token}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'ARCHIVE_EXPIRY_UNAVAILABLE' })
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
