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

export function resolvePostgresUrl(env = process.env) {
  for (const key of POSTGRES_ENV_KEYS) {
    if (isPostgresUrl(env[key])) return env[key].trim()
  }

  return isPostgresUrl(env.DATABASE_URL) ? env.DATABASE_URL.trim() : null
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

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__zuriPrisma = prisma
}

export default prisma
