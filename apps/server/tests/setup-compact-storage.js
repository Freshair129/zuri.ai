// @spec ADR-115 — only the global-setup-provided disposable application database.
// @tested tests/storage/compact-business-objects.test.js
import { inject } from 'vitest'
import { compactStorageDatabaseEnvironment } from './helpers/compact-storage-database.mjs'
const selected = compactStorageDatabaseEnvironment(process.env, inject('testDatabaseUrl'))
for (const key of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL']) delete process.env[key]
process.env.DATABASE_URL = selected.DATABASE_URL
process.env.DIRECT_URL = selected.DIRECT_URL
