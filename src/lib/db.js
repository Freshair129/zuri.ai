import { PrismaClient } from '@prisma/client'
import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'

// @req FR-030, FR-076, FR-078 — use the provider-specific application client;
// never make a SQLite-generated client parse a production Postgres URL.
// @spec ADR-018, docs/DB-MIGRATION-NOTES.md.
// @tested tests/unit/db-runtime-config.test.js

const POSTGRES_ENV_KEYS = [
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_POSTGRES_URL',
]

function isPostgresUrl(value) {
  return typeof value === 'string' && /^(postgres|postgresql):/i.test(value.trim())
}

function normalizeSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return url
  // Convert Supabase session pooler (port 5432) to transaction pooler (port 6543)
  // and ensure an already-transaction-pooler URL also disables session-only behavior.
  if (!/\.pooler\.supabase\.com:(?:5432|6543)/i.test(url)) return url

  const normalized = url.replace(/\.pooler\.supabase\.com:5432/i, '.pooler.supabase.com:6543')
  try {
    const parsed = new URL(normalized)
    if (parsed.searchParams.get('pgbouncer') !== 'true') parsed.searchParams.set('pgbouncer', 'true')
    return parsed.toString()
  } catch {
    return normalized
  }
}

export function resolvePostgresUrl(env = process.env) {
  for (const key of POSTGRES_ENV_KEYS) {
    if (isPostgresUrl(env[key])) return normalizeSupabaseUrl(env[key].trim())
  }

  return isPostgresUrl(env.DATABASE_URL) ? normalizeSupabaseUrl(env.DATABASE_URL.trim()) : null
}

export function requireProductionDatabaseUrl(env = process.env) {
  const postgresUrl = resolvePostgresUrl(env)
  const isNextProductionBuild = env.NEXT_PHASE === 'phase-production-build'
  if (env.NODE_ENV === 'production' && !postgresUrl && !isNextProductionBuild) {
    throw new Error('PRODUCTION_DATABASE_URL_REQUIRED')
  }
  return postgresUrl
}

// Prisma singleton (Next.js dev-server hot-reload safe).
const globalForPrisma = globalThis

const postgresUrl = requireProductionDatabaseUrl()

const usePostgres = Boolean(postgresUrl)

if (usePostgres && postgresUrl) {
  process.env.DATABASE_URL = postgresUrl
}

const RuntimePrismaClient = usePostgres ? PostgresPrismaClient : PrismaClient

export const prisma = globalForPrisma.__zuriPrisma ?? new RuntimePrismaClient(
  usePostgres && postgresUrl ? { datasources: { db: { url: postgresUrl } } } : undefined
)

globalForPrisma.__zuriPrisma = prisma

export default prisma
