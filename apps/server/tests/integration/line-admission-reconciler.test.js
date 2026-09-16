import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { LINE_OA_PROVIDER } from '@/platform/integrations/providers/line/line-oa-webhook'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { reconcileAbandonedLineAdmissions } from '@/modules/line-oa-studio/application/line-admission-reconciler'

// @req FR-149 — crash-recovery sweep for events acknowledged to LINE but never
//   admitted because the process died between the ack and the in-process,
//   not-awaited `admitCapturedLineEvents` call finishing.
// @spec ADR-061, SEC-001
// @tested tests/integration/line-admission-reconciler.test.js

let tenant, business, provider, connection, account, orphanConnection, counter = 0

const start = new Date('2026-09-10T12:00:00.000Z')
const STALE = 60_000
const olderThanStale = (ms = 1) => new Date(start.getTime() - STALE - ms)
const withinStale = (ms = 1) => new Date(start.getTime() - STALE + ms)

/** Build a raw event, optionally still carrying a `replyToken` — production
 * evidence never does (redacted before persistence), but this suite plants
 * one on purpose so the reconciler's own defensive strip is what is proven,
 * not an accident of how the fixture was built. */
function lineEvent(id, over = {}) {
  return {
    type: 'message', webhookEventId: `admin-recon-event-${id}`, replyToken: `admin-recon-token-${id}`,
    source: { type: 'user', userId: `admin-recon-user-${id}` },
    message: { type: 'text', id: `admin-recon-message-${id}`, text: `reconcile me ${id}` },
    ...over,
  }
}

async function admittingRecord({
  event = lineEvent(++counter),
  connectionId = connection.id,
  receivedAt = olderThanStale(),
  payloadJson,
} = {}) {
  const id = `admin-recon-record-${counter}`
  return prisma.rawExternalRecord.create({
    data: {
      tenantId: tenant.id, businessId: business.id, connectionId,
      provider: LINE_OA_PROVIDER, lane: 'CUSTOMER', entityType: 'LINE_MESSAGE',
      externalId: `admin-recon-external-${counter}-${Math.random()}`,
      sourceType: 'WEBHOOK', schemaVersion: 'line.messaging-api.webhook.v1',
      payloadJson: payloadJson ?? JSON.stringify({ destination: 'admin-recon-destination', event }),
      payloadHash: `admin-recon-hash-${counter}-${Math.random()}`,
      idempotencyKey: `admin-recon-idem-${id}-${Math.random()}`,
      receivedAt, processingStatus: 'ADMITTING',
    },
  })
}
const reload = (id) => prisma.rawExternalRecord.findUnique({ where: { id } })

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Admission reconciler', code: 'PF-ADMIN-RECON' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Admission reconciler tenant', code: 'TNT-ADMIN-RECON' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Admission reconciler business', code: 'BUS-ADMIN-RECON' })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  connection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'Admission reconciler connection', externalAccountId: 'admin-recon-oa', status: 'ACTIVE',
  })
  account = await prisma.lineOaAccount.create({ data: {
    tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id,
    code: 'admin-recon-account', displayName: 'Admission reconciler OA', bindingCode: 'admin-recon-binding',
    transportMode: 'CLOUD', serverEnabled: true, status: 'CONNECTED', executionMode: 'SERVER',
    modelAccess: 'EXTERNAL_MODEL_ALLOWED', allowDelayedPush: false,
  } })
  // A real IntegrationConnection (satisfies the FK on RawExternalRecord.connectionId)
  // that no LineOaAccount is bound to — the "evidence outlived its account" case.
  orphanConnection = await createIntegrationConnection({
    tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'Admission reconciler orphan connection', externalAccountId: 'admin-recon-orphan-oa', status: 'ACTIVE',
  })
})

/** A hand-rolled counting proxy rather than `vi.spyOn` on the Prisma client:
 * Prisma's delegates are not stable objects across property access, and
 * mutating one snapshot leaves later calls unspied (or worse, corrupts the
 * shared client for later tests) — the same reason `server-line-jobs.test.js`
 * builds its `failingTransaction` proxy by hand instead of spying. */
function countingDb() {
  const calls = { findMany: 0, update: 0, accountFindUnique: 0 }
  const proxy = new Proxy(prisma, {
    get(target, prop) {
      if (prop === 'rawExternalRecord') {
        return new Proxy(target.rawExternalRecord, {
          get(inner, method) {
            if (method === 'findMany') return (...args) => { calls.findMany += 1; return inner.findMany(...args) }
            if (method === 'update') return (...args) => { calls.update += 1; return inner.update(...args) }
            return inner[method]
          },
        })
      }
      if (prop === 'lineOaAccount') {
        return new Proxy(target.lineOaAccount, {
          get(inner, method) {
            if (method === 'findUnique') return (...args) => { calls.accountFindUnique += 1; return inner.findUnique(...args) }
            return inner[method]
          },
        })
      }
      return target[prop]
    },
  })
  return { proxy, calls }
}

// Every test owns its own rows and cleans them up: the idle-path assertion
// (exactly one query, zero rows found) would be meaningless if an earlier
// test's leftovers were still sitting in `ADMITTING`.
afterEach(async () => {
  await prisma.lineConversationJob.deleteMany({ where: { tenantId: tenant.id } })
  await prisma.rawExternalRecord.deleteMany({ where: { tenantId: tenant.id } })
})

describe('reconcileAbandonedLineAdmissions', () => {
  it('admits a stale ADMITTING row with the real admitter and relabels it ADMITTED', async () => {
    const record = await admittingRecord()
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit: admitLineConversation, env: { ZURI_LINE_REPLY_SEAL_KEY: 'a7'.repeat(32) } })
    expect(outcome).toEqual({ scanned: 1, admitted: 1, skipped: 0, failed: 0 })
    expect((await reload(record.id)).processingStatus).toBe('ADMITTED')
    const job = await prisma.lineConversationJob.findFirst({ where: { accountId: account.id } })
    expect(job).toBeTruthy()
    // No surviving reply token: `sealLineReplyToken(undefined, …)` returns `null`,
    // so the job can only ever be sent as a PUSH (or terminate REPLY_EXPIRED_PUSH_DISABLED).
    expect(job.sealedReplyToken).toBeNull()
    expect(job.replyExpiresAt).toBeNull()
    expect(job.correlationId).toBe(`reconcile:${record.id}`)
  })

  it('leaves a row younger than staleAfterMs alone — it is still an in-flight admission, not an abandoned one', async () => {
    const record = await admittingRecord({ receivedAt: withinStale() })
    const admit = vi.fn()
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit })
    expect(outcome).toEqual({ scanned: 0, admitted: 0, skipped: 0, failed: 0 })
    expect(admit).not.toHaveBeenCalled()
    expect((await reload(record.id)).processingStatus).toBe('ADMITTING')
  })

  it('never selects RECEIVED, ADMITTED, SKIPPED or FAILED rows, however old', async () => {
    const rows = await Promise.all(
      ['RECEIVED', 'ADMITTED', 'SKIPPED', 'FAILED'].map((processingStatus) =>
        prisma.rawExternalRecord.create({ data: {
          tenantId: tenant.id, businessId: business.id, connectionId: connection.id,
          provider: LINE_OA_PROVIDER, lane: 'CUSTOMER', entityType: 'LINE_MESSAGE',
          externalId: `admin-recon-status-${processingStatus}-${Math.random()}`,
          sourceType: 'WEBHOOK', schemaVersion: 'line.messaging-api.webhook.v1',
          payloadJson: JSON.stringify({ destination: 'admin-recon-destination', event: lineEvent(`status-${processingStatus}`) }),
          payloadHash: `admin-recon-hash-${processingStatus}-${Math.random()}`,
          idempotencyKey: `admin-recon-idem-${processingStatus}-${Math.random()}`,
          receivedAt: olderThanStale(), processingStatus,
        } })),
    )
    const admit = vi.fn()
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit })
    expect(outcome).toEqual({ scanned: 0, admitted: 0, skipped: 0, failed: 0 })
    expect(admit).not.toHaveBeenCalled()
    for (const row of rows) expect((await reload(row.id)).processingStatus).toBe(row.processingStatus)
  })

  it('strips replyToken before calling admit — the load-bearing push-only property', async () => {
    const record = await admittingRecord()
    const admit = vi.fn(async () => ({ jobId: 'job-x', created: true, inboundMessageId: 'msg-x' }))
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit })
    expect(outcome.admitted).toBe(1)
    expect(admit).toHaveBeenCalledTimes(1)
    const passedEvent = admit.mock.calls[0][0].event
    expect('replyToken' in passedEvent).toBe(false)
    expect(passedEvent.replyToken).toBeUndefined()
    // The correlation id is stable/attributable, not a fresh random value per tick.
    expect(admit.mock.calls[0][0].correlationId).toBe(`reconcile:${record.id}`)
  })

  it('one throwing row does not stop its neighbours, and only the throwing row is labelled FAILED', async () => {
    const bad = await admittingRecord({ receivedAt: olderThanStale(2000) })
    const good = await admittingRecord({ receivedAt: olderThanStale(1000) })
    const admit = vi.fn(async ({ correlationId }) => {
      if (correlationId === `reconcile:${bad.id}`) throw new Error('ADMIT_BOOM')
      return { jobId: 'job-good', created: true, inboundMessageId: 'msg-good' }
    })
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit, take: 5 })
    expect(outcome).toEqual({ scanned: 2, admitted: 1, skipped: 0, failed: 1 })
    expect(admit).toHaveBeenCalledTimes(2)
    expect(await reload(bad.id)).toMatchObject({ processingStatus: 'FAILED', processingError: 'ADMIT_BOOM' })
    expect((await reload(good.id)).processingStatus).toBe('ADMITTED')
  })

  it('labels unparseable payloadJson FAILED without throwing, and never calls admit', async () => {
    const record = await admittingRecord({ payloadJson: 'not-json{' })
    const admit = vi.fn()
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit })
    expect(outcome).toEqual({ scanned: 1, admitted: 0, skipped: 0, failed: 1 })
    expect(admit).not.toHaveBeenCalled()
    const reloaded = await reload(record.id)
    expect(reloaded.processingStatus).toBe('FAILED')
    expect(reloaded.processingError).toContain('LINE_RECONCILE_PAYLOAD_INVALID')
  })

  it('labels a connectionId with no matching LineOaAccount FAILED without throwing', async () => {
    const record = await admittingRecord({ connectionId: orphanConnection.id })
    const admit = vi.fn()
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit })
    expect(outcome).toEqual({ scanned: 1, admitted: 0, skipped: 0, failed: 1 })
    expect(admit).not.toHaveBeenCalled()
    const reloaded = await reload(record.id)
    expect(reloaded.processingStatus).toBe('FAILED')
    expect(reloaded.processingError).toBe('LINE_RECONCILE_ACCOUNT_NOT_FOUND')
  })

  it('honours `take` — never scans more than the bound in one pass', async () => {
    const records = []
    for (let i = 0; i < 7; i += 1) records.push(await admittingRecord({ receivedAt: olderThanStale(1000 + i) }))
    const admit = vi.fn(async () => ({ jobId: 'job-take', created: true, inboundMessageId: `msg-take-${Math.random()}` }))
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit, take: 3 })
    expect(outcome.scanned).toBe(3)
    expect(admit).toHaveBeenCalledTimes(3)
    const stillAdmitting = await prisma.rawExternalRecord.count({
      where: { id: { in: records.map((r) => r.id) }, processingStatus: 'ADMITTING' },
    })
    expect(stillAdmitting).toBe(4)
  })

  it('idle path (no candidate rows) costs exactly one query and returns zeros', async () => {
    const { proxy, calls } = countingDb()
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, db: proxy })
    expect(outcome).toEqual({ scanned: 0, admitted: 0, skipped: 0, failed: 0 })
    expect(calls.findMany).toBe(1)
    expect(calls.update).toBe(0)
    expect(calls.accountFindUnique).toBe(0)
  })

  it('skips exactly as admitCapturedLineEvents does — no jobId means SKIPPED, not ADMITTED', async () => {
    const record = await admittingRecord()
    const admit = vi.fn(async () => ({ skipped: true }))
    const outcome = await reconcileAbandonedLineAdmissions({ now: start, admit })
    expect(outcome).toEqual({ scanned: 1, admitted: 0, skipped: 1, failed: 0 })
    expect((await reload(record.id)).processingStatus).toBe('SKIPPED')
  })
})
