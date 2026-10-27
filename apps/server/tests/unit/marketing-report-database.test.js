// @req FR-281, FR-282 — trusted provider selection and safe unknown-provider refusal.
// @spec ADR-115, SDD-112
// @tested src/modules/marketing/infrastructure/marketing-report-database.js
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as adapter from '@/modules/marketing/infrastructure/marketing-report-database'

const postgresDb = { $transaction: vi.fn() }, clients = []
afterAll(async () => { for (const client of clients) await client.$disconnect() })
describe('Marketing report database provider boundary', () => {
  it('keeps bounded SQLite URLs and refuses other protocols', () => {
    expect(adapter.reportDatabaseUrl('file:owned.sqlite?other=1')).toBe('file:owned.sqlite?other=1&socket_timeout=1&connection_limit=1')
    expect(adapter.reportDatabaseUrl('postgresql://unselected.invalid/db')).toBeNull()
  })
  it('uses the selected canonical PostgreSQL client without constructing another authority', () => {
    expect(typeof adapter.resolveMarketingReportDatabase).toBe('function')
    const result = adapter.resolveMarketingReportDatabase({ env: { ZURI_MARKETING_REPORT_DATABASE_PROVIDER: 'postgresql', DATABASE_URL: 'postgresql://test.invalid/owned' }, postgresDb })
    expect(result).toEqual({ db: postgresDb, provider: 'postgresql' })
  })
  it.each(['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL'])('honors the canonical %s alias over a SQLite fallback', alias => {
    expect(typeof adapter.resolveMarketingReportDatabase).toBe('function')
    expect(adapter.resolveMarketingReportDatabase({ env: { ZURI_MARKETING_REPORT_DATABASE_PROVIDER: 'postgresql', DATABASE_URL: 'file:unused.sqlite', [alias]: 'postgresql://test.invalid/owned' }, postgresDb })).toEqual({ db: postgresDb, provider: 'postgresql' })
  })
  it('preserves a separate bounded SQLite client and refuses absent, unknown or invalid authority', () => {
    expect(typeof adapter.resolveMarketingReportDatabase).toBe('function')
    for (const env of [{}, { DATABASE_URL: 'mysql://foreign.invalid/db' }, { DATABASE_URL: 'postgresql://test.invalid/owned' }, { ZURI_MARKETING_REPORT_DATABASE_PROVIDER: 'unknown', DATABASE_URL: 'postgresql://test.invalid/owned' }, { DATABASE_URL: 'file:unused.sqlite', POSTGRES_URL: 'postgresql://test.invalid/owned' }]) expect(adapter.resolveMarketingReportDatabase({ env, postgresDb })).toBeNull()
    expect(adapter.resolveMarketingReportDatabase({ env: { ZURI_MARKETING_REPORT_DATABASE_PROVIDER: 'postgresql', DATABASE_URL: 'postgresql://test.invalid/owned' }, postgresDb: {} })).toBeNull()
    const result = adapter.resolveMarketingReportDatabase({ env: { DATABASE_URL: 'file:./.test-dbs/marketing-resolver-owned.db' }, postgresDb })
    clients.push(result.db)
    expect(result.provider).toBe('sqlite'); expect(result.db).not.toBe(postgresDb)
    expect(adapter.resolveMarketingReportDatabase({ env: { DATABASE_URL: 'file:./.test-dbs/different-owned.db' }, postgresDb })).toBeNull()
  })
})
