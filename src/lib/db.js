import { PrismaClient } from '@prisma/client'
import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'

// @req FR-030, FR-076, FR-078 — use the provider-specific application client;
// never make a SQLite-generated client parse a production Postgres URL.
// @spec ADR-018, docs/DB-MIGRATION-NOTES.md.

// Prisma singleton (Next.js dev-server hot-reload safe).
const globalForPrisma = globalThis
const usePostgres = /^(postgres|postgresql):/i.test(process.env.DATABASE_URL || '')
const RuntimePrismaClient = usePostgres ? PostgresPrismaClient : PrismaClient

export const prisma = globalForPrisma.__zuriPrisma ?? new RuntimePrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__zuriPrisma = prisma
}

export default prisma
