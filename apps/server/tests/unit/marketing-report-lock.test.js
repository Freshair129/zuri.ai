// @req FR-281, FR-282 — deterministic provider-specific policy-before-binding locking.
// @spec ADR-115, SDD-112
// @tested src/modules/marketing/application/marketing-report-lock.js
import { afterEach, describe, expect, it, vi } from 'vitest'
const module = await import('@/modules/marketing/application/marketing-report-lock').catch(() => null)
describe('Marketing report scope locks', () => {
  afterEach(() => vi.restoreAllMocks())
  it('keeps the SQLite first statement a no-op binding write without changing policy/version', async () => {
    expect(module).not.toBeNull()
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn() }
    await module.lockMarketingReportScope(tx, { provider: 'sqlite', keyHash: 'a'.repeat(64) })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toMatch(/UPDATE "MarketingReportBinding" SET "id"="id" WHERE "keyHash"=\?/)
  })
  it('locks an existing PostgreSQL policy before its binding with bounded waits', async () => {
    expect(module).not.toBeNull()
    const calls = [], tx = { $executeRawUnsafe: vi.fn(async sql => calls.push(sql)), $queryRaw: vi.fn(async (sql) => { calls.push(sql.join('?')); return [{}] }) }
    await module.lockMarketingReportScope(tx, { provider: 'postgresql', businessId: 'business', bindingId: 'binding' })
    expect(calls[0]).toMatch(/lock_timeout/)
    expect(calls.findIndex(sql => /MarketingReportPolicy.*FOR UPDATE/.test(sql))).toBeLessThan(calls.findIndex(sql => /MarketingReportBinding.*FOR UPDATE/.test(sql)))
    expect(calls.join(' ')).not.toMatch(/UPDATE .*SET/)
  })
  it('serializes absent-policy creation with a transaction advisory lock and rereads the row', async () => {
    expect(module).not.toBeNull()
    const calls = [], tx = { $executeRawUnsafe: vi.fn(), $queryRaw: vi.fn(async sql => { const text = sql.join('?'); calls.push(text); return [] }) }
    await module.lockMarketingReportScope(tx, { provider: 'postgresql', businessId: 'business' })
    expect(calls[0]).toMatch(/MarketingReportPolicy.*FOR UPDATE/)
    expect(calls[1]).toMatch(/pg_advisory_xact_lock.*::text/)
    expect(calls[2]).toMatch(/MarketingReportPolicy.*FOR UPDATE/)
  })
  it('refuses an unknown provider before any database operation and recognizes PostgreSQL retry codes', async () => {
    expect(module).not.toBeNull()
    const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() }
    await expect(module.lockMarketingReportScope(tx, { provider: 'unknown', businessId: 'business' })).rejects.toMatchObject({ status: 503 })
    expect(tx.$queryRaw).not.toHaveBeenCalled(); expect(tx.$executeRaw).not.toHaveBeenCalled()
    for (const code of ['55P03', '40P01', '40001', '57014']) expect(module.marketingReportRetryable({ code: 'P2010', meta: { code } }, 'postgresql')).toBe(true)
    expect(module.marketingReportRetryable({ code: 'P2002', meta: { target: ['bindingId', 'sourceReportId'] } }, 'postgresql')).toBe(true)
    expect(module.marketingReportRetryable({ code: 'P2002', meta: { target: ['id'] } }, 'postgresql')).toBe(false)
  })
  it('refuses a known Prisma provider mismatch before opening a transaction', async () => {
    const db = { _activeProvider: 'postgresql', $transaction: vi.fn().mockResolvedValue('unqualified receipt') }
    await expect(module.withMarketingReportTransaction(db, 'sqlite', async () => 'receipt')).rejects.toMatchObject({ status: 503 })
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('budgets pool wait plus transaction execution inside the remaining deadline', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(4500).mockReturnValueOnce(4501)
    const db = { $transaction: vi.fn().mockResolvedValue('receipt') }
    await module.withMarketingReportTransaction(db, 'postgresql', async () => 'receipt')
    const options = db.$transaction.mock.calls[0][1]
    expect(options.maxWait + options.timeout).toBeLessThanOrEqual(500)
  })
  it('locks Business then the hinted Plan then Initiative and refuses a changed plan hint', async () => {
    expect(typeof module.lockMarketingReportTarget).toBe('function')
    const calls = [], tx = { marketingInitiative: { findFirst: vi.fn().mockResolvedValue({ planId: 'plan' }) }, $queryRaw: vi.fn(async sql => { calls.push(sql.join('?')); return [{ id: 'target', planId: 'plan' }] }) }
    await module.lockMarketingReportTarget(tx, { provider: 'postgresql', businessId: 'business', initiativeId: 'initiative' })
    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatch(/Business.*FOR UPDATE/); expect(calls[1]).toMatch(/MarketingPlan.*FOR UPDATE/); expect(calls[2]).toMatch(/MarketingInitiative.*FOR UPDATE/)
    tx.$queryRaw.mockImplementation(async sql => /MarketingInitiative/.test(sql.join('?')) ? [{ id: 'target', planId: 'changed-plan' }] : [{ id: 'target' }])
    await expect(module.lockMarketingReportTarget(tx, { provider: 'postgresql', businessId: 'business', initiativeId: 'initiative' })).rejects.toMatchObject({ code: 'P2034' })
  })
})
