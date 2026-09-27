import { parentPort, workerData } from 'node:worker_threads'

import { createSqliteObservationStoreFactory } from '../../src/adapters/sqlite-observation-store.js'

// One worker = one independent SQLite connection. The parent releases every worker at
// once through a shared Int32Array so the inserts genuinely overlap.
const { location, draft, scope, gate } = workerData
const flag = new Int32Array(gate)
const factory = createSqliteObservationStoreFactory({ location })
const store = await factory.open(scope)
Atomics.wait(flag, 0, 0)
try {
  const result = await store.insertIfAbsent({
    ...draft,
    observedAt: new Date(draft.observedAt),
    translatedAt: new Date(draft.translatedAt),
  })
  parentPort.postMessage({ status: result.status })
} catch (error) {
  parentPort.postMessage({ error: error.message })
} finally {
  await factory.close()
}
