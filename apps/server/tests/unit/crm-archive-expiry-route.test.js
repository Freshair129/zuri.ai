import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'

// @req FR-245, SEC-034 — the daily deployment trigger for format-4 archive
//   retirement; bearer validation precedes work, and HTTP responses contain
//   aggregate counts only (ADR-093 D5 P7).
// @spec ADR-093 D5 (1.3.0), SDD-103, SEC-001
// @tested tests/unit/crm-archive-expiry-route.test.js
const mocks = vi.hoisted(() => ({ run: vi.fn(), resolveDir: vi.fn(), assertReady: vi.fn() }))
vi.mock('@/modules/crm/chat-evidence-archive-expiry-run-service', () => ({ runChatEvidenceArchiveExpiry: mocks.run }))
vi.mock('@/modules/crm/chat-evidence-archive-service', () => ({
  resolveArchiveBaseDir: mocks.resolveDir,
  assertArchiveStorageReady: mocks.assertReady,
}))

import { POST } from '@/app/api/crm/archive-expiry/route'

const token = 'e'.repeat(40)
const fixedNow = new Date('2036-05-04T12:30:00.000Z')
const request = (authorization) => new Request('http://local/api/crm/archive-expiry', {
  method: 'POST', headers: authorization ? { authorization } : {},
})
const day = (date = new Date()) => date.toISOString().slice(0, 10)
const claimId = (date = new Date()) => `archive-expiry-claim:${day(date)}`
const completedId = (date = new Date()) => `archive-expiry-test-completed:${day(date)}`
const counts = {
  tenantsVisited: 3,
  tenantsDeferred: 0,
  keysDestroyed: 2,
  holdKeysDestroyed: 1,
  manifestsRetired: 2,
  filesDeleted: 2,
  retiredFilesAlreadyAbsent: 0,
  retiredFilesStillPresent: 0,
  skipped: 0,
  failures: 0,
}
const cleanupIds = new Set()

function trackDate(date = new Date()) {
  cleanupIds.add(claimId(date))
  cleanupIds.add(completedId(date))
}

async function seedAudit({ id, action, occurredAt = new Date(), payload = {} }) {
  cleanupIds.add(id)
  return prisma.auditEvent.create({ data: {
    id,
    entityType: 'ARCHIVE_EXPIRY_RUN',
    entityId: id,
    action,
    actorType: 'SYSTEM',
    payloadJson: JSON.stringify(payload),
    occurredAt,
  } })
}

beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_RETENTION_SWEEP_TOKEN', token)
  vi.stubEnv('NODE_ENV', 'test')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(fixedNow)
  cleanupIds.clear()
  trackDate(fixedNow)
  mocks.resolveDir.mockReturnValue('/tmp/archive-expiry-route-test')
  mocks.assertReady.mockResolvedValue('/tmp/archive-expiry-route-test')
  mocks.run.mockResolvedValue({ auditEventId: 'private-audit-id', counts })
  await prisma.auditEvent.deleteMany({ where: { id: { in: [...cleanupIds] } } })
})

afterEach(async () => {
  if (cleanupIds.size) await prisma.auditEvent.deleteMany({ where: { id: { in: [...cleanupIds] } } })
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

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
    expect(mocks.assertReady).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
    expect(await prisma.auditEvent.findUnique({ where: { id: claimId(fixedNow) } })).toBeNull()
  })

  it('claims the UTC day once and returns only aggregate counts', async () => {
    const response = await POST(request(`Bearer ${token}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ counts, alreadyRanToday: false })
    expect(mocks.run).toHaveBeenCalledTimes(1)
    const [db, options] = mocks.run.mock.calls[0]
    expect(db).toBe(prisma)
    expect(options.now).toBeInstanceOf(Date)
    expect(options.deadlineAt).toBeUndefined()

    const claim = await prisma.auditEvent.findUnique({ where: { id: claimId(fixedNow) } })
    expect(claim).toMatchObject({
      id: claimId(fixedNow), entityType: 'ARCHIVE_EXPIRY_RUN',
      action: 'ARCHIVE_EXPIRY_RUN_CLAIMED', actorType: 'SYSTEM',
    })
    expect(JSON.stringify(body)).not.toMatch(/customer|filePath|private-audit-id/i)
  })

  it('passes the successful production storage preflight into the awaited run', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const response = await POST(request(`Bearer ${token}`))

    expect(response.status).toBe(200)
    expect(mocks.assertReady).toHaveBeenCalledTimes(1)
    expect(mocks.assertReady).toHaveBeenCalledWith('/tmp/archive-expiry-route-test', process.env)
    expect(mocks.run).toHaveBeenCalledTimes(1)
    expect(mocks.run.mock.calls[0][1]).toMatchObject({
      baseDir: '/tmp/archive-expiry-route-test', storagePrechecked: true,
    })
  })

  it('answers from a completed run in the same UTC day without claiming or running again', async () => {
    await seedAudit({
      id: completedId(fixedNow),
      action: 'ARCHIVE_EXPIRY_RUN_COMPLETED',
      occurredAt: fixedNow,
      payload: { counts },
    })

    const response = await POST(request(`Bearer ${token}`))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ counts, alreadyRanToday: true })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(await prisma.auditEvent.findUnique({ where: { id: claimId(fixedNow) } })).toBeNull()
  })

  it('allows exactly one of two concurrent POSTs to run and waits for that run to settle', async () => {
    let announceStarted
    let releaseRun
    let runCount = 0
    const started = new Promise((resolve) => { announceStarted = resolve })
    const gate = new Promise((resolve) => { releaseRun = resolve })
    mocks.run.mockImplementation(async () => {
      runCount += 1
      if (runCount === 1) {
        announceStarted()
        await gate
      }
      return { auditEventId: 'private-audit-id', counts }
    })

    let firstFinished = false
    const first = POST(request(`Bearer ${token}`)).then((response) => {
      firstFinished = true
      return response
    })
    await started
    expect(firstFinished).toBe(false)

    try {
      const second = await POST(request(`Bearer ${token}`))
      expect(second.status).toBe(409)
      expect(await second.json()).toEqual({ error: 'ARCHIVE_EXPIRY_RUN_IN_PROGRESS' })
      expect(mocks.run).toHaveBeenCalledTimes(1)
      expect(firstFinished).toBe(false)
    } finally {
      releaseRun()
    }
    const firstResponse = await first
    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.json()).toEqual({ counts, alreadyRanToday: false })
    expect(firstFinished).toBe(true)
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })

  it('answers 409 when a prior same-day claim has no completion after a crash', async () => {
    await seedAudit({ id: claimId(fixedNow), action: 'ARCHIVE_EXPIRY_RUN_CLAIMED', occurredAt: fixedNow })

    const response = await POST(request(`Bearer ${token}`))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'ARCHIVE_EXPIRY_RUN_IN_PROGRESS' })
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('refuses unavailable production storage before writing a claim', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mocks.assertReady.mockRejectedValue(Object.assign(new Error('private storage detail'), { code: 'ARCHIVE_STORAGE_REQUIRED' }))

    const response = await POST(request(`Bearer ${token}`))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'ARCHIVE_EXPIRY_UNAVAILABLE' })
    expect(mocks.resolveDir).toHaveBeenCalledWith(process.env)
    expect(mocks.assertReady).toHaveBeenCalledTimes(1)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(await prisma.auditEvent.findUnique({ where: { id: claimId(fixedNow) } })).toBeNull()
  })

  it('uses a new claim on the next UTC day and reports deferred Tenants in the response counts', async () => {
    mocks.run.mockResolvedValueOnce({ auditEventId: 'run-one', counts })
    const first = await POST(request(`Bearer ${token}`))
    expect(first.status).toBe(200)

    const nextDay = new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000)
    trackDate(nextDay)
    vi.setSystemTime(nextDay)
    const deferredCounts = { ...counts, tenantsDeferred: 3 }
    mocks.run.mockResolvedValueOnce({ auditEventId: 'run-two', counts: deferredCounts })
    const next = await POST(request(`Bearer ${token}`))

    expect(next.status).toBe(200)
    expect(await next.json()).toEqual({ counts: deferredCounts, alreadyRanToday: false })
    expect(mocks.run).toHaveBeenCalledTimes(2)
    expect(await prisma.auditEvent.findUnique({ where: { id: claimId(nextDay) } })).toMatchObject({
      action: 'ARCHIVE_EXPIRY_RUN_CLAIMED', actorType: 'SYSTEM',
    })
  })

  it('returns 503 when the run fails but leaves the claim to prevent a same-day overlap', async () => {
    mocks.run.mockRejectedValueOnce(new Error('private run failure'))
    const response = await POST(request(`Bearer ${token}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'ARCHIVE_EXPIRY_UNAVAILABLE' })
    expect(await prisma.auditEvent.findUnique({ where: { id: claimId(fixedNow) } })).toBeTruthy()
  })
})
