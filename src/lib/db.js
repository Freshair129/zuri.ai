import { PrismaClient } from '@prisma/client'

// Prisma singleton (Next.js dev-server hot-reload safe).
const globalForPrisma = globalThis

export const prisma = globalForPrisma.__zuriPrisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__zuriPrisma = prisma
}

export default prisma
