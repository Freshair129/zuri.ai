// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-282 — bound SQLite lock waits without changing the native shared client.
import { PrismaClient } from '@prisma/client'
import canonicalDatabase, { resolvePostgresUrl } from '@/lib/db'

export function reportDatabaseUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null
  const index = url.indexOf('?'), base = index < 0 ? url : url.slice(0, index)
  const parameters = new URLSearchParams(index < 0 ? '' : url.slice(index + 1))
  parameters.set('socket_timeout', '1')
  parameters.set('connection_limit', '1')
  return base + '?' + parameters
}

export function resolveMarketingReportDatabase({ env = process.env, postgresDb = canonicalDatabase } = {}) {
  const provider = env.ZURI_MARKETING_REPORT_DATABASE_PROVIDER ?? 'sqlite'
  if (!['sqlite', 'postgresql'].includes(provider)) return null
  const postgresUrl = resolvePostgresUrl(env)
  // An ambient PostgreSQL URL cannot activate the historical disabled mirror.
  // Explicit server selection and the canonical target client are both needed.
  if (provider === 'postgresql') return postgresUrl && typeof postgresDb?.$transaction === 'function' ? { db: postgresDb, provider } : null
  if (postgresUrl) return null
  const url = reportDatabaseUrl(env.DATABASE_URL)
  if (!url) return null
  const cached = globalThis.__marketingReportDatabase
  if (cached && cached.url !== url) return null
  if (cached) return { db: cached.db, provider }
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] })
  globalThis.__marketingReportDatabase = { url, db }
  return { db, provider }
}

export function marketingReportDatabase(options) { return resolveMarketingReportDatabase(options)?.db ?? null }
