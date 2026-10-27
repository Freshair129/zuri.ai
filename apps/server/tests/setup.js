// Point the Prisma client at this run's isolated test database.
// globalSetup provides one closed SQLite schema template. Each test file gets
// an exclusive clone before its imports, so src/lib/db.js picks up that file's URL.
//
// The URL comes from globalSetup through vitest's provide/inject channel rather
// than an environment variable: inject is the documented contract between the
// main process and the workers, so it holds whatever pool vitest forks, while
// env inheritance is a fork-time side effect that a pool change could take away.
import { afterAll, expect, inject } from 'vitest'
import {
  directUrlForFileDatabase,
  prepareTestDatabaseForFile,
  removeFileTestDatabase,
} from './helpers/file-test-database.js'

const databaseUrl = inject('testDatabaseUrl')
if (!databaseUrl) {
  throw new Error(
    'No test database was provided. tests/setup.js expects tests/global-setup.js to run first — ' +
      'check that the vitest config still lists it under globalSetup.',
  )
}

const engine = inject('testDatabaseEngine') ?? (/^postgres(?:ql)?:/i.test(databaseUrl) ? 'postgresql' : 'sqlite')
const runPrefix = inject('testDatabaseRunPrefix')

async function disconnectCachedClient() {
  const client = globalThis.__zuriPrisma
  if (!client) return
  try {
    await client.$disconnect()
  } finally {
    if (globalThis.__zuriPrisma === client) delete globalThis.__zuriPrisma
  }
}

// A module-global PrismaClient can survive worker reuse between files. Close it
// before changing DATABASE_URL so the next file cannot inherit the old target.
if (engine === 'sqlite') await disconnectCachedClient()

let fileDatabase = null
if (engine === 'sqlite' && !runPrefix) throw new Error('No SQLite test database run prefix was provided by globalSetup.')
const selected = prepareTestDatabaseForFile({
  databaseUrl,
  engine,
  testPath: engine === 'sqlite' ? expect.getState().testPath : undefined,
  runPrefix,
})
fileDatabase = selected.fileDatabase
if (fileDatabase) {
  if (process.env.DIRECT_URL !== undefined) {
    process.env.DIRECT_URL = directUrlForFileDatabase(process.env.DIRECT_URL, databaseUrl, selected.url)
  }
}
process.env.DATABASE_URL = selected.url

// Vitest runs afterAll hooks in reverse registration order, so test-file hooks
// finish before the cached client is closed and this file's clone is removed.
if (fileDatabase) {
  afterAll(async () => {
    await disconnectCachedClient()
    removeFileTestDatabase(fileDatabase.file, fileDatabase.runPrefix)
  })
}
