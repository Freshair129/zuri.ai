import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { createSqliteObservationStoreFactory } from '../src/adapters/sqlite-observation-store.js'
import { runObservationStoreConformance } from './store-conformance.js'
import { BUSINESS_A, TENANT_T } from './fakes.js'

// node:sqlite adapter against the shared conformance suite, on a real file so the race
// runs through separate connections in separate threads.

function race(location) {
  return (draft, n) => {
    const gate = new SharedArrayBuffer(4)
    const serial = { ...draft, observedAt: draft.observedAt.toISOString(), translatedAt: draft.translatedAt.toISOString() }
    const workers = Array.from({ length: n }, () => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./support/sqlite-race-worker.js', import.meta.url), {
        workerData: { location, draft: serial, scope: { tenantId: TENANT_T, businessId: BUSINESS_A }, gate },
      })
      worker.once('message', (message) => (message.error ? reject(new Error(message.error)) : resolve(message.status)))
      worker.once('error', reject)
    }))
    setTimeout(() => {
      const flag = new Int32Array(gate)
      Atomics.store(flag, 0, 1)
      Atomics.notify(flag, 0)
    }, 200)
    return Promise.all(workers)
  }
}

runObservationStoreConformance('sqlite', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'market-sqlite-'))
  const location = path.join(dir, 'market.db')
  let factory = createSqliteObservationStoreFactory({ location })
  return {
    get factory() { return factory },
    race: race(location),
    async reopen() {
      await factory.close()
      factory = createSqliteObservationStoreFactory({ location })
      return factory
    },
    async cleanup() {
      try { await factory.close() } catch { /* already closed */ }
      rmSync(dir, { recursive: true, force: true })
    },
  }
})
