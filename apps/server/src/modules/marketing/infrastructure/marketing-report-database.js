// @tested tests/unit/marketing-report-wire.test.js, tests/integration/marketing-report-native.test.js
// @req FR-282 — bound SQLite lock waits without changing the native shared client.
import { PrismaClient } from '@prisma/client'

export function reportDatabaseUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null
  const index = url.indexOf('?'), base = index < 0 ? url : url.slice(0, index)
  const parameters = new URLSearchParams(index < 0 ? '' : url.slice(index + 1))
  parameters.set('socket_timeout', '1')
  parameters.set('connection_limit', '1')
  return base + '?' + parameters
}

export function marketingReportDatabase() {
  // PostgreSQL artifacts establish portability intent, not a qualified receiver.
  if (['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL'].some(key => /^(postgres|postgresql):/i.test(process.env[key] || ''))) return null
  const url = reportDatabaseUrl(process.env.DATABASE_URL)
  if (!url) return null
  const cached = globalThis.__marketingReportDatabase
  if (cached && cached.url !== url) return null
  if (cached) return cached.db
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] })
  globalThis.__marketingReportDatabase = { url, db }
  return db
}
