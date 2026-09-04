import { PrismaClient } from '@prisma/client'
import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'

// @req FR-030, FR-076, FR-078 — use the provider-specific application client;
// never make a SQLite-generated client parse a production Postgres URL.
// @req FR-145 — select the Supabase pooler MODE by runtime topology, not
//   unconditionally: a single long-running process (this app's Docker
//   deployment, ADR-058) wants Supavisor SESSION pooling (a small, stable
//   connection count, one Postgres round trip per query); a serverless
//   platform wants TRANSACTION pooling (many concurrent short-lived
//   invocations must not exhaust Postgres's connection limit, at the cost of
//   a per-transaction backend checkout on every query). Measured 2026-09-04
//   against the production Supabase project from the Docker deployment: the
//   same host, warm connection pool, transaction mode (port 6543,
//   pgbouncer=true) cost ~650-750ms per trivial query with no improvement
//   across repeated calls; session mode (port 5432) cost ~130-145ms, matching
//   raw TCP RTT — a ~5x difference, sustained. `resolvePoolMode` below was
//   'transaction' unconditionally before this — correct for Vercel, silently
//   wrong for a container.
// @spec ADR-018, docs/DB-MIGRATION-NOTES.md, ADR-058 D9.
// @tested tests/unit/db-runtime-config.test.js

const POSTGRES_ENV_KEYS = [
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'DATABASE_POSTGRES_URL',
]

const POOL_MODES = new Set(['session', 'transaction'])

function isPostgresUrl(value) {
  return typeof value === 'string' && /^(postgres|postgresql):/i.test(value.trim())
}

/**
 * Which Supavisor pooler mode to normalize a Supabase pooler URL into.
 *
 * `ZURI_DB_POOL_MODE` is an explicit operator override (`session` |
 * `transaction`) and always wins when set to one of those two values — for a
 * topology neither branch below guesses correctly (e.g. multiple container
 * replicas sharing one Postgres, which needs transaction-mode safety despite
 * not being Vercel). Otherwise: `VERCEL` (the platform's own env var, present
 * in every Vercel function invocation) means serverless → `transaction`;
 * its absence means a single long-running process → `session`. This inverts
 * the FR-030-era default, which forced `transaction` for every deployment
 * target because Vercel was the only one that existed.
 */
export function resolvePoolMode(env = process.env) {
  const explicit = typeof env.ZURI_DB_POOL_MODE === 'string' ? env.ZURI_DB_POOL_MODE.trim().toLowerCase() : ''
  if (POOL_MODES.has(explicit)) return explicit
  return env.VERCEL ? 'transaction' : 'session'
}

function normalizeSupabaseUrl(url, poolMode) {
  if (!url || typeof url !== 'string') return url
  // Only a Supavisor pooler URL is mode-sensitive; anything else (a direct
  // connection, a non-Supabase Postgres, a test fixture host) passes through.
  if (!/\.pooler\.supabase\.com:(?:5432|6543)/i.test(url)) return url

  if (poolMode === 'session') {
    // Session pooler: port 5432, no `pgbouncer` param — Supavisor proxies a
    // full Postgres session, so none of the transaction-mode compatibility
    // flags apply.
    const normalized = url.replace(/\.pooler\.supabase\.com:6543/i, '.pooler.supabase.com:5432')
    try {
      const parsed = new URL(normalized)
      parsed.searchParams.delete('pgbouncer')
      return parsed.toString()
    } catch {
      return normalized
    }
  }

  // Transaction pooler: port 6543 + pgbouncer=true, so Prisma disables the
  // prepared-statement caching Supavisor's transaction mode can't support.
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
  const poolMode = resolvePoolMode(env)
  for (const key of POSTGRES_ENV_KEYS) {
    if (isPostgresUrl(env[key])) return normalizeSupabaseUrl(env[key].trim(), poolMode)
  }

  return isPostgresUrl(env.DATABASE_URL) ? normalizeSupabaseUrl(env.DATABASE_URL.trim(), poolMode) : null
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
