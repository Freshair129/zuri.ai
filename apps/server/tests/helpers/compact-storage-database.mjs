// @spec ADR-115 — ambient PostgreSQL aliases cannot select the storage fixture's application database.
// @tested tests/unit/private-business-object-storage.test.js
export function compactStorageDatabaseEnvironment(environment, testDatabaseUrl) {
  if (typeof testDatabaseUrl !== 'string' || !/^file:\.\/\.test-dbs\/run-[A-Za-z0-9-]+\.db$/.test(testDatabaseUrl)) throw new Error('COMPACT_STORAGE_DISPOSABLE_DATABASE_REQUIRED')
  const selected = { ...environment, DATABASE_URL: testDatabaseUrl, DIRECT_URL: testDatabaseUrl }
  for (const key of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL']) delete selected[key]
  return selected
}
