import { PrismaClient } from '@prisma/client'
import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'

// @req FR-030, FR-076, FR-078 — use the provider-specific application client;
// never make a SQLite-generated client parse a production Postgres URL.
// @spec ADR-018, docs/DB-MIGRATION-NOTES.md.

const SUPABASE_DEFAULT_POSTGRES_URL = 'postgresql://postgres.qcnmhyglarzcpudjorzc:Suanranger1295@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'

// Prisma singleton (Next.js dev-server hot-reload safe).
const globalForPrisma = globalThis

const postgresUrl = process.env.POSTGRES_PRISMA_URL ||
                    process.env.POSTGRES_URL ||
                    process.env.POSTGRES_URL_NON_POOLING ||
                    process.env.DATABASE_POSTGRES_URL ||
                    (/^(postgres|postgresql):/i.test(process.env.DATABASE_URL || '') ? process.env.DATABASE_URL : null) ||
                    (process.env.NODE_ENV === 'production' ? SUPABASE_DEFAULT_POSTGRES_URL : null)

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
