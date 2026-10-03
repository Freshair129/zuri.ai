import { test } from 'node:test'

import { createPgObservationStoreFactory } from '../src/adapters/pg-observation-store.js'
import { runObservationStoreConformance } from './store-conformance.js'
import { BUSINESS_A, TENANT_T } from './fakes.js'

// Postgres adapter against the shared conformance suite. Needs a DISPOSABLE database:
// `npm run test:pg` starts one in its own container and sets MARKET_TEST_PG_URL.
// Without it the suite is reported as skipped with a NOT_RUN reason, never as a pass.
const url = process.env.MARKET_TEST_PG_URL

if (!url) {
  test('postgres conformance', (t) => t.skip('NOT_RUN: MARKET_TEST_PG_URL is unset (run `npm run test:pg`)'))
} else {
  runObservationStoreConformance('postgres', async () => {
    let factory = createPgObservationStoreFactory({ connectionString: url })
    await factory.ensureTestSchema({ disposable: true })
    await factory.pool.query('TRUNCATE "MarketObservation"')
    return {
      get factory() { return factory },
      async race(draft, n) {
        // n factories, one connection each, released together.
        const racers = Array.from({ length: n }, () => createPgObservationStoreFactory({ connectionString: url, max: 1 }))
        try {
          const stores = await Promise.all(racers.map((racer) => racer.open({ tenantId: TENANT_T, businessId: BUSINESS_A })))
          await Promise.all(racers.map((racer) => racer.ping()))
          const results = await Promise.all(stores.map((store) => store.insertIfAbsent(draft)))
          return results.map((result) => result.status)
        } finally {
          await Promise.all(racers.map((racer) => racer.close()))
        }
      },
      async reopen() {
        await factory.close()
        factory = createPgObservationStoreFactory({ connectionString: url })
        return factory
      },
      async cleanup() {
        try { await factory.close() } catch { /* already closed */ }
      },
    }
  })
}
