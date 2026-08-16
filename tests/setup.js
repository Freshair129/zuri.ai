// Point the Prisma client at this run's isolated test database.
// Runs before any test-file import, so src/lib/db.js picks this up.
//
// The URL comes from globalSetup through vitest's provide/inject channel rather
// than an environment variable: inject is the documented contract between the
// main process and the workers, so it holds whatever pool vitest forks, while
// env inheritance is a fork-time side effect that a pool change could take away.
import { inject } from 'vitest'

const databaseUrl = inject('testDatabaseUrl')
if (!databaseUrl) {
  throw new Error(
    'No test database was provided. tests/setup.js expects tests/global-setup.js to run first — ' +
      'check that the vitest config still lists it under globalSetup.',
  )
}

process.env.DATABASE_URL = databaseUrl
